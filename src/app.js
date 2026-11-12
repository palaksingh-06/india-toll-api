const express = require("express");
require("dotenv").config();

const axios = require("axios");
const pool = require("./db");
const app = express();

app.use(express.json());

const PLAZA_LIMIT = 200;
const PLAZA_RADIUS_METERS = 100;
const VEHICLE_CATEGORIES = [
  "car",
  "lcv",
  "bus",
  "multiaxle",
  "axle_4_6",
  "axle_7_plus",
  "hcm",
];
const JOURNEY_TYPES = ["single", "return"];
const ORS_DIRECTIONS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions";
const TRUCK_PROFILE = process.env.ORS_TRUCK_PROFILE || "driving-hgv";
const CLOSED_SYSTEM_PATTERN = /close\s*loop|entry\s*exit/i;

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function isValidPoint(point) {
  if (!Array.isArray(point) || point.length !== 2) {
    return false;
  }

  const [longitude, latitude] = point;

  return (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

app.get("/api/v1/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "India Toll API is running",
      database: "connected",
    });
  } catch (error) {
    console.error("Health check database failure:", error.message);

    res.status(503).json({
      success: false,
      message: "API is running but database is unavailable",
      database: "disconnected",
    });
  }
});

app.get("/api/v1/toll-plazas", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      100
    );

    const result = await pool.query(
      `SELECT source_id, name, highway, state,
              latitude, longitude, is_active
       FROM toll_plazas
       WHERE is_active = TRUE
       ORDER BY name
       LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error("Failed to fetch toll plazas:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to fetch toll plazas",
    });
  }
});

app.post("/api/v1/route", async (req, res) => {
  try {
    const {
      source,
      destination,
      vehicle_category = "car",
      journey_type = "single",
      include_geometry = false,
    } = req.body || {};

    if (!VEHICLE_CATEGORIES.includes(vehicle_category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle category.",
        allowed_categories: VEHICLE_CATEGORIES,
      });
    }

    if (!JOURNEY_TYPES.includes(journey_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid journey type.",
        allowed_journey_types: JOURNEY_TYPES,
      });
    }

    if (!isValidPoint(source) || !isValidPoint(destination)) {
      return res.status(400).json({
        success: false,
        message:
          "Source and destination must be [longitude, latitude] arrays of valid numbers.",
      });
    }

    if (!process.env.ORS_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Routing API key is not configured.",
      });
    }

    const routingProfile =
      vehicle_category === "car" ? "driving-car" : TRUCK_PROFILE;

    const routeResponse = await axios.post(
      `${ORS_DIRECTIONS_URL}/${routingProfile}/geojson`,
      { coordinates: [source, destination] },
      {
        headers: {
          Authorization: process.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const feature = routeResponse.data.features?.[0];

    if (!feature?.geometry?.coordinates?.length) {
      return res.status(502).json({
        success: false,
        message: "No route geometry was returned.",
      });
    }

    const routeGeometry = JSON.stringify(feature.geometry);

    const plazaResult = await pool.query(
      `WITH route AS (
         SELECT ST_SetSRID(
           ST_GeomFromGeoJSON($1),
           4326
         ) AS geom
       )
       SELECT
         p.source_id,
         p.name,
         p.highway,
         p.state,
         p.latitude,
         p.longitude,
         ROUND(
           (
             ST_Distance(p.location, route.geom::geography) / 1000
           )::numeric,
           3
         ) AS distance_from_route_km,
         ROUND(
           (
             ST_LineLocatePoint(route.geom, p.location::geometry)
             * ST_Length(route.geom::geography) / 1000
           )::numeric,
           1
         ) AS approx_km_from_start,
         r.amount_inr AS rate_inr,
         r.effective_from AS rate_effective_from,
         r.effective_to AS rate_effective_to,
         p.data_source,
         p.data_confidence,
         p.rate_revision_date::text AS rate_revision_date
       FROM toll_plazas p
       CROSS JOIN route
       LEFT JOIN LATERAL (
         SELECT
           tr.amount_inr,
           tr.effective_from,
           tr.effective_to
         FROM toll_rates tr
         WHERE tr.plaza_id = p.id
           AND tr.vehicle_category = $2
           AND tr.rate_type = $4
           AND tr.effective_from <= CURRENT_DATE
           AND (
             tr.effective_to IS NULL
             OR tr.effective_to >= CURRENT_DATE
           )
         ORDER BY tr.effective_from DESC
         LIMIT 1
       ) r ON TRUE
       WHERE p.is_active = TRUE
         AND ST_DWithin(
           p.location,
           route.geom::geography,
           $5
         )
       ORDER BY ST_Distance(p.location, route.geom::geography) ASC
       LIMIT $3`,
      [
        routeGeometry,
        vehicle_category,
        PLAZA_LIMIT,
        journey_type,
        PLAZA_RADIUS_METERS,
      ]
    );

    const tollPlazas = plazaResult.rows
      .map((row) => {
        const rate = row.rate_inr === null ? null : Number(row.rate_inr);

        let rateStatus = "available";
        if (rate === null) {
          rateStatus = "missing";
        } else if (rate === 0) {
          rateStatus = "zero_in_source";
        }

        return {
          source_id: row.source_id,
          name: row.name,
          highway: row.highway,
          state: row.state,
          latitude: row.latitude,
          longitude: row.longitude,
          approx_km_from_start: Number(row.approx_km_from_start),
          distance_from_route_km: Number(row.distance_from_route_km),
          toll_inr: rateStatus === "available" ? rate : null,
          rate_status: rateStatus,
          likely_closed_system: CLOSED_SYSTEM_PATTERN.test(row.name || ""),
          rate_effective_from: row.rate_effective_from,
          rate_effective_to: row.rate_effective_to,
          data_source: row.data_source,
          data_confidence: row.data_confidence,
          rate_revision_date: row.rate_revision_date,
        };
      })
      .sort((a, b) => a.approx_km_from_start - b.approx_km_from_start);

    const today = todayInIndia();

    for (const plaza of tollPlazas) {
      if (!plaza.rate_revision_date) {
        plaza.rate_freshness = "unknown";
      } else if (plaza.rate_revision_date >= today) {
        plaza.rate_freshness = "current";
      } else {
        plaza.rate_freshness = "past_revision_date";
      }
    }

    const withRate = tollPlazas.filter((p) => p.rate_status === "available");
    const closedSystemCount = tollPlazas.filter(
      (p) => p.likely_closed_system
    ).length;
    const truncated = plazaResult.rowCount >= PLAZA_LIMIT;
    const pastRevisionCount = tollPlazas.filter(
      (p) => p.rate_freshness === "past_revision_date"
    ).length;
    const complete = withRate.length === tollPlazas.length && !truncated;
    const knownSubtotal = withRate.reduce((sum, p) => sum + p.toll_inr, 0);

    let rateConfidence = "high";
    if (withRate.length === 0) {
      rateConfidence = "none";
    } else if (
      withRate.some(
        (p) => p.data_source !== "nhai" || p.rate_freshness === "unknown"
      )
    ) {
      rateConfidence = "low";
    } else if (
      withRate.some((p) => p.rate_freshness === "past_revision_date")
    ) {
      rateConfidence = "medium";
    }
    const dataSources = [...new Set(withRate.map((p) => p.data_source))];

    const warnings = [];

    if (truncated) {
      warnings.push(
        `${PLAZA_LIMIT} plazas were returned and more may exist; the list is cut off.`
      );
    }

    if (withRate.length < tollPlazas.length) {
      warnings.push(
        "Some plazas have no usable rate, so no total is given. A rate of 0 in the source is not treated as free."
      );
    }

    if (closedSystemCount > 0) {
      warnings.push(
        "Some plazas look like closed-system tolls (entry/exit based). Their fee depends on the entry and exit points and is not in the per-plaza rates."
      );
    }

    if (pastRevisionCount > 0) {
      warnings.push(
        `${pastRevisionCount} plaza(s) have a rate whose revision date has passed; the published rate may have changed.`
      );
    }

    if (journey_type === "return") {
      warnings.push(
        "Return fees are the published return-journey fee per plaza, normally valid for a return within 24 hours."
      );
    }

    const data = {
      vehicle_category,
      journey_type,
      routing_profile: routingProfile,
      distance_meters: feature.properties.summary.distance,
      duration_seconds: feature.properties.summary.duration,
      toll_plaza_candidates: plazaResult.rowCount,
      toll_summary: {
        total_toll_inr: complete ? knownSubtotal : null,
        known_subtotal_inr: knownSubtotal,
        plazas_with_rate: withRate.length,
        plazas_without_rate: tollPlazas.length - withRate.length,
        likely_closed_system_plazas: closedSystemCount,
        plazas_past_revision_date: pastRevisionCount,
        rate_confidence: rateConfidence,
        data_sources: dataSources,
        list_may_be_truncated: truncated,
        warnings,
      },
      toll_plazas: tollPlazas,
    };

    if (include_geometry === true) {
      data.route_geometry = feature.geometry;
    }

    res.json({ success: true, data });
  } catch (error) {
    const upstreamStatus = error.response?.status || null;

    console.error(
      "Route request failed:",
      upstreamStatus || error.message,
      error.response?.data?.error?.message || ""
    );

    res.status(502).json({
      success: false,
      message: "Unable to calculate route or find nearby toll plazas.",
      upstream_status: upstreamStatus,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
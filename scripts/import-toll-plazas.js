require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const filePath = path.join(__dirname, "..", "data", "toll-plazas-raw.json");

const vehicleCategories = [
  "car",
  "lcv",
  "bus",
  "multiaxle",
  "axle_4_6",
  "axle_7_plus",
  "hcm",
];

const rateTypes = ["single", "return", "monthly", "commercial"];

const sourceUrl = "https://github.com/ForceGT/india-toll-plazas";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toDate(value) {
  const time = Date.parse(value);

  if (!value || Number.isNaN(time)) {
    return null;
  }

  return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function toHighwayLabel(value) {
  const text = value ? String(value).trim() : "";

  if (!text) {
    return null;
  }

  return /^[A-Za-z]/.test(text) ? text : `NH ${text}`;
}

async function importData() {
  const plazas = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(plazas)) {
    throw new Error("The JSON file must contain an array.");
  }

  const client = await pool.connect();

  let plazasImported = 0;
  let plazasUpdated = 0;
  let plazasSkipped = 0;
  let ratesImported = 0;

  try {
    await client.query("BEGIN");

    for (const p of plazas) {
      const sourceId = toNumber(p.tollplaza_id);
      const latitude = toNumber(p.latitude);
      const longitude = toNumber(p.longitude);

      if (
        sourceId === null ||
        !p.tollplaza_name ||
        latitude === null ||
        longitude === null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        plazasSkipped++;
        continue;
      }

      const existing = await client.query(
        "SELECT id FROM toll_plazas WHERE source_id = $1",
        [sourceId]
      );

      const plazaResult = await client.query(
        `INSERT INTO toll_plazas (
          source_id, name, highway, state,
          latitude, longitude, source_url,
          last_verified_at, is_active,
          data_source, data_confidence, source_updated_at,
          rate_revision_date
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          NULL, $8, $9, $10, $11, $12
        )
        ON CONFLICT (source_id) DO UPDATE SET
          name = EXCLUDED.name,
          highway = EXCLUDED.highway,
          state = EXCLUDED.state,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          source_url = EXCLUDED.source_url,
          is_active = EXCLUDED.is_active,
          data_source = EXCLUDED.data_source,
          data_confidence = EXCLUDED.data_confidence,
          source_updated_at = EXCLUDED.source_updated_at,
          rate_revision_date = EXCLUDED.rate_revision_date
        RETURNING id`,
        [
          sourceId,
          p.tollplaza_name,
          toHighwayLabel(p.nh_no),
          p.state_name || null,
          latitude,
          longitude,
          sourceUrl,
          p.active !== false,
          p.data_source || null,
          p.data_confidence || null,
          p.last_updated || null,
          toDate(p.rate_revision_date),
        ]
      );

      const plazaId = plazaResult.rows[0].id;

      if (existing.rowCount > 0) {
        plazasUpdated++;
      } else {
        plazasImported++;
      }

      await client.query(
        `DELETE FROM toll_rates
         WHERE plaza_id = $1 AND source_url = $2`,
        [plazaId, sourceUrl]
      );

      const effectiveFrom =
        toDate(p.rate_effective_date) || toDate(p.last_updated);

      if (!effectiveFrom) {
        continue;
      }

      for (const category of vehicleCategories) {
        for (const rateType of rateTypes) {
          const amount = toNumber(p[`${category}_${rateType}`]);

          if (amount === null || amount < 0) {
            continue;
          }

          await client.query(
            `INSERT INTO toll_rates (
              plaza_id, vehicle_category, amount_inr,
              effective_from, source_url, verified_at, rate_type
            )
            VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
            [plazaId, category, amount, effectiveFrom, sourceUrl, rateType]
          );

          ratesImported++;
        }
      }
    }

    await client.query("COMMIT");

    console.log("Import completed successfully.");
    console.log("New plazas:", plazasImported);
    console.log("Existing plazas updated:", plazasUpdated);
    console.log("Invalid records skipped:", plazasSkipped);
    console.log("Rate rows imported:", ratesImported);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

importData().catch((error) => {
  console.error("Import failed:", error.message);
  process.exitCode = 1;
});
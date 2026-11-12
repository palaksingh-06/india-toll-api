# India Toll Calculation API

A REST API for estimating toll charges on road routes within India using **Node.js, Express, PostgreSQL, PostGIS, and OpenRouteService (ORS)**.

The API accepts source and destination coordinates, calculates a road route, identifies nearby toll-plaza candidates, and retrieves applicable toll rates for different vehicle categories.

> Toll amounts are estimates based on the available dataset. They should be independently verified before operational or financial use.

## Features

- Calculate road routes between source and destination coordinates.
- Support seven vehicle categories, including commercial trucks.
- Support single and return toll-rate calculations.
- Identify toll-plaza candidates near the calculated route.
- Retrieve applicable rates from PostgreSQL.
- Distinguish available, missing, and zero-valued source rates.
- Calculate known toll subtotals and report incomplete estimates.
- Return route distance, duration, toll details, and data-quality warnings.
- Optionally return route geometry as GeoJSON.
- Health endpoint with database connectivity verification.
- Automated API smoke tests using Node.js built-in testing utilities.

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- PostGIS
- OpenRouteService / HeiGIT routing API
- Axios
- Git and GitHub

## Supported Vehicle Categories

| API value | Vehicle category |
|---|---|
| `car` | Car / Jeep / Van |
| `lcv` | Light Commercial Vehicle |
| `bus` | Bus / Truck (2 axle) |
| `multiaxle` | 3 axle |
| `axle_4_6` | 4 to 6 axle |
| `axle_7_plus` | 7 or more axle |
| `hcm` | HCM / EME |

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/palaksingh-06/india-toll-api.git
cd india-toll-api
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root using `.env.example` as a reference.

```env
PORT=3000
DATABASE_URL=postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE_NAME
ORS_API_KEY=YOUR_ORS_API_KEY
ORS_TRUCK_PROFILE=driving-hgv
```

Configuration:

- `PORT`: API server port. Defaults to `3000`.
- `DATABASE_URL`: PostgreSQL connection string.
- `ORS_API_KEY`: API key for the routing service.
- `ORS_TRUCK_PROFILE`: Truck routing profile. Defaults to `driving-hgv`.

Never commit your `.env` file or expose API credentials.

### 4. Set up PostgreSQL and PostGIS

Create a PostgreSQL database and enable the PostGIS extension.

The required database tables must be initialized before importing toll data or running the API. The application uses the `toll_plazas` and `toll_rates` tables.

**Note:** The database schema is not currently included as a standalone SQL migration file in this repository. An appropriately initialized database is therefore required.

### 5. Import toll data

The import script reads:

```text
data/toll-plazas-raw.json
```

This raw JSON file is excluded from GitHub and must be obtained separately.

The project's data pipeline uses the [ForceGT India Toll Plazas dataset](https://github.com/ForceGT/india-toll-plazas).

Place the prepared JSON array at the expected path and run:

```bash
node scripts/import-toll-plazas.js
```

The importer inserts new toll plazas, updates existing records, and imports available rates for supported vehicle categories and rate types.

The import operation uses a database transaction and can be rerun to update existing records.

### 6. Start the API server

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

By default, the server runs at:

```text
http://localhost:3000
```

## API Endpoints

### 1. Health Check

**GET** `/api/v1/health`

Checks whether the API is running and the database is accessible.

Example:

```bash
curl http://localhost:3000/api/v1/health
```

Successful response:

```json
{
  "success": true,
  "message": "India Toll API is running",
  "database": "connected"
}
```

Returns HTTP `503` if the database is unavailable.

### 2. List Toll Plazas

**GET** `/api/v1/toll-plazas`

Returns active toll plazas from the database.

Optional query parameter:

| Parameter | Description | Default | Range |
|---|---|---|---|
| `limit` | Maximum number of plazas | 20 | 1–100 |

Example:

```bash
curl "http://localhost:3000/api/v1/toll-plazas?limit=5"
```

Response structure:

```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "source_id": 123,
      "name": "Example Toll Plaza",
      "highway": "NH 44",
      "state": "Haryana",
      "latitude": 29.0,
      "longitude": 76.0,
      "is_active": true
    }
  ]
}
```

The plaza values above are illustrative.

### 3. Calculate Route and Toll Estimate

**POST** `/api/v1/route`

Calculates a road route and identifies toll-plaza candidates along it.

Example request:

```json
{
  "source": [77.2090, 28.6139],
  "destination": [76.7794, 30.7333],
  "vehicle_category": "axle_4_6",
  "journey_type": "single",
  "include_geometry": false
}
```

**Request parameters**

| Parameter | Required | Description |
|---|---|---|
| `source` | Yes | Starting point as `[longitude, latitude]` |
| `destination` | Yes | Destination as `[longitude, latitude]` |
| `vehicle_category` | No | Vehicle category; defaults to `car` |
| `journey_type` | No | `single` or `return`; defaults to `single` |
| `include_geometry` | No | Set to `true` to include route GeoJSON |

**Journey types**

- `single`: Retrieves the single-journey toll rate.
- `return`: Retrieves the published return-journey toll rate.

**Example using curl**

```bash
curl -X POST http://localhost:3000/api/v1/route \
  -H "Content-Type: application/json" \
  -d '{
    "source": [77.2090, 28.6139],
    "destination": [76.7794, 30.7333],
    "vehicle_category": "axle_4_6",
    "journey_type": "single",
    "include_geometry": false
  }'
```

**Response structure**

A successful response contains:

```json
{
  "success": true,
  "data": {
    "vehicle_category": "axle_4_6",
    "journey_type": "single",
    "routing_profile": "driving-hgv",
    "distance_meters": 267767.2,
    "duration_seconds": 12792,
    "toll_plaza_candidates": 6,
    "toll_summary": {
      "total_toll_inr": null,
      "known_subtotal_inr": 2080,
      "plazas_with_rate": 4,
      "plazas_without_rate": 2,
      "likely_closed_system_plazas": 1,
      "plazas_past_revision_date": 3,
      "rate_confidence": "medium",
      "data_sources": ["nhai"],
      "list_may_be_truncated": false,
      "warnings": []
    },
    "toll_plazas": []
  }
}
```

The numbers above illustrate a previously tested Delhi–Chandigarh truck-route response; live results may differ as routing and source data change. The `toll_plazas` array contains individual plaza details.

When `include_geometry` is `true`, the response additionally includes `route_geometry` as a GeoJSON `LineString`.

## Toll Rate Interpretation

Each toll-plaza candidate has a rate status:

| Status | Meaning |
|---|---|
| `available` | A usable rate was found. |
| `missing` | No applicable rate was found. |
| `zero_in_source` | The source dataset contains a zero value. |

A zero-valued source rate is **not automatically treated as a free toll**.

### Toll Summary

- `known_subtotal_inr`: Sum of rates that are available.
- `total_toll_inr`: Complete total only when all identified candidates have usable rates and the candidate list is not truncated.
- `plazas_with_rate`: Number of candidates with usable rates.
- `plazas_without_rate`: Number of candidates without usable rates.
- `rate_confidence`: An indication based on source and rate freshness metadata.
- `warnings`: Important data-quality and calculation warnings.

If one or more candidates lack usable rates, `total_toll_inr` is returned as `null` rather than presenting an incomplete subtotal as the final toll amount.

## Automated Testing

The project includes an automated smoke-test script.

Run the API server in one terminal:

```bash
npm run dev
```

In another terminal, execute:

```bash
npm test
```

The smoke tests verify:

1. API health and database connectivity.
2. Toll-plaza listing.
3. Car single-journey calculation.
4. Truck single-journey calculation (4–6 axle).
5. Car return-journey calculation.
6. Invalid vehicle-category validation.
7. Invalid-coordinate validation.
8. Route geometry when enabled.
9. Route geometry when disabled.

The tests use Node.js built-in `fetch` and assertions, so no additional testing library is required.

**Requirements:** A running API server, a working PostgreSQL/PostGIS database, and a valid routing API key for successful route tests. Route tests also depend on the external routing service being available.

## Data Sources and Routing

- Toll plaza and rate records are imported from the [ForceGT India Toll Plazas dataset](https://github.com/ForceGT/india-toll-plazas).
- Road routes are obtained through the HeiGIT/OpenRouteService directions API.
- PostgreSQL and PostGIS are used for toll-plaza storage and spatial proximity queries.

The importer preserves source and confidence metadata where available. Confidence labels reflect the data-processing pipeline and do not represent independent verification of every toll rate.

## Important Limitations

- Toll plazas identified near a route are candidates, not confirmation that a vehicle must pay at every identified plaza.
- The application currently identifies candidates within 100 metres of the calculated route.
- Closed-loop toll systems may require entry and exit information that is not currently calculated.
- Missing or zero-valued rates can prevent a complete toll estimate.
- Rates with past revision dates may have changed and should be verified.
- The API does not currently implement API-client authentication, usage tracking, or geocoding.
- Truck routing uses the configured OpenRouteService truck profile; route suitability should be checked for the actual vehicle.
- The raw toll dataset and database schema must be supplied or initialized separately.

## Future Improvements

- API key authentication and usage tracking.
- Improved closed-loop toll calculation using entry and exit points.
- Automated toll-rate updates and verification.
- Improved route and toll-plaza matching.
- Expanded automated testing and integration coverage.

## License

A license has not yet been assigned to this repository.


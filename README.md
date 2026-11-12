# India Toll Calculation API

A REST API for estimating toll charges on road routes within India using Node.js, Express, PostgreSQL, PostGIS and OpenRouteService.

## Features

- Calculate toll estimates between source and destination coordinates.
- Support for seven vehicle categories.
- Single and return journey estimates.
- Identify toll plazas along a calculated route.
- Retrieve applicable toll rates from PostgreSQL.
- Report missing or zero-valued source rates separately.
- Return route distance, duration, toll details and warnings.
- Provide a health endpoint that checks database connectivity.

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- PostGIS
- OpenRouteService (ORS)
- Axios

## Supported Vehicle Categories

| Category | Vehicle type |
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

Required configuration:

```env
PORT=3000
DATABASE_URL=your_postgresql_connection_string
ORS_API_KEY=your_openrouteservice_api_key
ORS_TRUCK_PROFILE=driving-hgv
```

Never commit your `.env` file or expose API credentials.

### 4. Set up the database

Create a PostgreSQL database with PostGIS enabled and configure its connection string in `DATABASE_URL`.

The database schema and toll data must be initialized before using the route calculation endpoint.

### 5. Start the server

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

The API runs on port 3000 by default.

## API Endpoints

### Health Check

`GET /api/v1/health`

Checks API and database connectivity.

### List Toll Plazas

`GET /api/v1/toll-plazas?limit=20`

Returns active toll plazas. The limit can range from 1 to 100.

### Calculate Route Toll Estimate

`POST /api/v1/route`

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

Coordinates use `[longitude, latitude]` format.

Supported journey types:

- `single`
- `return`

Vehicle category defaults to `car` and journey type defaults to `single` when omitted.

## Toll Rate Interpretation

The API distinguishes between three rate statuses:

- `available`: A usable rate was found.
- `missing`: No applicable rate was found.
- `zero_in_source`: The source dataset contains a zero value.

A zero value is not automatically interpreted as a free toll.

The API reports a known subtotal where rates are available. A complete total is returned only when the route's identified toll candidates have usable rates and the candidate results are not truncated.

## Important Limitations

- Toll plazas identified near a route are candidates, not confirmation that a vehicle must pay at every plaza.
- Closed-loop toll systems may require entry and exit information that is not currently calculated.
- Missing or zero-valued rates can prevent a complete toll estimate.
- Toll rates and revision dates depend on the underlying dataset and should be independently verified before operational or financial use.
- The API currently does not implement API-client authentication, usage tracking or geocoding.
- Truck routing uses the configured OpenRouteService truck profile; route suitability should be validated for the actual vehicle.

## Data Sources

Toll plaza and rate data are imported from the project's processed toll data source. Source confidence labels reflect the data-processing pipeline and are not independent verification of every rate.

## Future Improvements

- API key authentication and usage tracking.
- Improved handling of closed-loop toll systems.
- Automated toll-rate updates and verification.
- Automated API tests.
- Improved route and toll-plaza matching.

## License

A license has not yet been assigned to this repository.


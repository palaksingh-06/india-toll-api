
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const SOURCE = [77.2090, 28.6139];
const DESTINATION = [76.7794, 30.7333];

let passed = 0;
let failed = 0;

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }

  return { status: response.status, data };
}

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  console.log(`\nTesting API: ${BASE_URL}\n`);

  await test("Health and database connection", async () => {
    const { status, data } = await request("/api/v1/health");

    assert(status === 200, `Expected 200, received ${status}`);
    assert(data.success === true, "API health check failed");
    assert(data.database === "connected", "Database is not connected");
  });

  await test("Toll-plaza listing", async () => {
    const { status, data } = await request("/api/v1/toll-plazas?limit=5");

    assert(status === 200, `Expected 200, received ${status}`);
    assert(data.success === true, "Request was unsuccessful");
    assert(Array.isArray(data.data), "Expected data to be an array");
    assert(data.data.length > 0, "No toll plazas returned");
    assert(data.data.length <= 5, "Limit was not respected");
  });

  async function routeRequest(category, journey, geometry = false) {
    return request("/api/v1/route", {
      method: "POST",
      body: JSON.stringify({
        source: SOURCE,
        destination: DESTINATION,
        vehicle_category: category,
        journey_type: journey,
        include_geometry: geometry,
      }),
    });
  }

  await test("Car single journey", async () => {
    const { status, data } = await routeRequest("car", "single");

    assert(status === 200, `Expected 200, received ${status}`);
    assert(data.success === true, "Route request failed");
    assert(data.data.vehicle_category === "car", "Wrong vehicle category");
    assert(data.data.journey_type === "single", "Wrong journey type");
    assert(data.data.distance_meters > 0, "Invalid route distance");
    assert(data.data.toll_summary, "Missing toll summary");
  });

  await test("Truck single journey (4-6 axle)", async () => {
    const { status, data } = await routeRequest("axle_4_6", "single");

    assert(status === 200, `Expected 200, received ${status}`);
    assert(data.success === true, "Route request failed");
    assert(
      data.data.vehicle_category === "axle_4_6",
      "Wrong vehicle category"
    );
    assert(
      data.data.routing_profile === "driving-hgv",
      "Wrong truck routing profile"
    );
  });

  await test("Car return journey", async () => {
    const { status, data } = await routeRequest("car", "return");

    assert(status === 200, `Expected 200, received ${status}`);
    assert(data.success === true, "Route request failed");
    assert(data.data.journey_type === "return", "Wrong journey type");

    assert(
      data.data.toll_summary.warnings.some((warning) =>
        warning.includes("Return fees")
      ),
      "Return tariff warning is missing"
    );
  });

  await test("Invalid vehicle category", async () => {
    const { status, data } = await request("/api/v1/route", {
      method: "POST",
      body: JSON.stringify({
        source: SOURCE,
        destination: DESTINATION,
        vehicle_category: "bike",
      }),
    });

    assert(status === 400, `Expected 400, received ${status}`);
    assert(data.success === false, "Expected failure response");
    assert(
      data.allowed_categories.includes("car"),
      "Allowed categories are missing"
    );
  });

  await test("Invalid coordinates", async () => {
    const { status, data } = await request("/api/v1/route", {
      method: "POST",
      body: JSON.stringify({
        source: [200, 28.6139],
        destination: DESTINATION,
        vehicle_category: "car",
      }),
    });

    assert(status === 400, `Expected 400, received ${status}`);
    assert(data.success === false, "Expected failure response");
    assert(
      data.message.includes("longitude, latitude"),
      "Unexpected validation message"
    );
  });

  await test("Route geometry enabled", async () => {
    const { status, data } = await routeRequest("car", "single", true);

    assert(status === 200, `Expected 200, received ${status}`);

    const geometry = data.data.route_geometry;

    assert(geometry, "Route geometry was not returned");
    assert(geometry.type === "LineString", "Expected LineString geometry");
    assert(
      geometry.coordinates.length > 0,
      "Geometry contains no coordinates"
    );
  });

  await test("Route geometry disabled", async () => {
    const { status, data } = await routeRequest("car", "single", false);

    assert(status === 200, `Expected 200, received ${status}`);
    assert(
      !Object.hasOwn(data.data, "route_geometry"),
      "Geometry should not be included"
    );
  });

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests().catch((error) => {
  console.error("\nTest runner error:", error.message);
  process.exitCode = 1;
});

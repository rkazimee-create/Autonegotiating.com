import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { Pool } from "undici";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, type ActiveInventory } from "@workspace/db";
import { INVENTORY_FRESHNESS_DAYS } from "./lib/inventory-qualification";
import { findQualifiedPersistedVehicle } from "./lib/persisted-vehicle-page";
import { renderVehiclePage } from "./lib/vehicle-page";
import vehiclePageRouter from "./routes/vehicle-page";

const TARGET_VIN = "1GYTEDKL5SU107838";

test("read-only production snapshot of the September quota-failure VIN renders persisted SSR 200", async () => {
  // Public inventory fields confirmed by read-only production SELECT on
  // 2026-10-01. This fixture does not seed or modify any database.
  const record = {
    vin: TARGET_VIN, year: 2025, make: "Cadillac", model: "Escalade IQ",
    trim: "Luxury 2", condition: "new", price: 151_015, mileage: 4,
    dealerName: "Kendall Cadillac of Eugene", dealerCity: "Eugene", dealerState: "OR",
    sourceUrl: null, active: true,
    firstSeen: new Date("2026-09-17T02:08:45.194Z"),
    lastSeen: new Date("2026-09-17T02:08:45.194Z"),
    updatedAt: new Date("2026-09-17T02:08:45.194Z"),
  } as ActiveInventory;
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-10-01T00:00:00Z");
  const restore = installDatabaseRows([record]);
  const { server, port } = await startVehicleServer();
  try {
    const guarded = await withNetworkGuards(async () => localRequest(port, `/vehicle/${TARGET_VIN}`));
    assert.equal(guarded.value.statusCode, 200);
    assert.match(guarded.value.body, /2025 Cadillac Escalade IQ Luxury 2/);
    assert.match(guarded.value.body, /151,015/);
    assert.match(guarded.value.body, /4 miles/);
    assert.match(guarded.value.body, /Kendall Cadillac of Eugene/);
    assert.match(guarded.value.body, /Eugene, OR/);
    assert.deepEqual(guarded.counts, { fetchCalls: 0, undiciCalls: 0 });
  } finally {
    restore();
    Date.now = originalNow;
    await closeLocal(server);
  }
});

// Illustrative fixture for the requested production VIN. Only the VIN and
// model identity are specified by the known example; price/mileage/dealer
// values are synthetic test data, not claims about its live listing.
const targetRecord = {
  vin: TARGET_VIN,
  year: 2025,
  make: "Cadillac",
  model: "Escalade IQ",
  trim: "Luxury2",
  condition: "used",
  price: 72_500,
  mileage: 1_250,
  dealerName: "Test Motors",
  dealerCity: "Portland",
  dealerState: "OR",
  sourceUrl: null,
  firstSeen: new Date("2026-08-01T00:00:00Z"),
  lastSeen: new Date(),
  updatedAt: new Date(),
  active: true,
} as ActiveInventory;
const capturedSql: string[] = [];
const capturedParams: unknown[][] = [];

type NetworkCounts = { fetchCalls: number; undiciCalls: number };

async function withNetworkGuards<T>(run: () => Promise<T>): Promise<{ value: T; counts: NetworkCounts }> {
  const originalFetch = globalThis.fetch;
  const originalRequest = Pool.prototype.request;
  const counts: NetworkCounts = { fetchCalls: 0, undiciCalls: 0 };
  globalThis.fetch = (async () => {
    counts.fetchCalls += 1;
    throw new Error("Unexpected fetch from a public VIN read");
  }) as typeof fetch;
  Pool.prototype.request = (async function () {
    counts.undiciCalls += 1;
    throw new Error("Unexpected undici request from a public VIN read");
  }) as typeof Pool.prototype.request;
  try {
    return { value: await run(), counts };
  } finally {
    globalThis.fetch = originalFetch;
    Pool.prototype.request = originalRequest;
  }
}

function installDatabaseRows(rows: ActiveInventory[]): () => void {
  const original = Object.getOwnPropertyDescriptor(db, "select");
  const select = function () {
    const builder = {
      from() { return this; },
      where(condition: any) {
        this.condition = condition;
        return this;
      },
      condition: undefined as any,
      async limit() {
        const query = new PgDialect().sqlToQuery(this.condition);
        capturedSql.push(query.sql);
        capturedParams.push(query.params);
        // Simulate PostgreSQL applying the predicate to the fixture rows.
        const now = Date.now();
        const freshnessCutoff = new Date(now - INVENTORY_FRESHNESS_DAYS * 86_400_000);
        const row = rows.find((candidate) =>
          candidate.active &&
          candidate.lastSeen >= freshnessCutoff &&
          /^[A-HJ-NPR-Z0-9]{17}$/i.test(candidate.vin) &&
          Boolean(candidate.make?.trim()) &&
          Boolean(candidate.model?.trim()) &&
          query.params.includes(candidate.vin),
        );
        return row ? [row] : [];
      },
    };
    return builder;
  };
  Object.defineProperty(db, "select", { configurable: true, value: select });
  return () => {
    if (original) Object.defineProperty(db, "select", original);
    else delete (db as unknown as { select?: unknown }).select;
  };
}

function listenLocal(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No local server address"));
      resolve(address.port);
    });
  });
}

function closeLocal(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function localRequest(port: number, path: string, method = "GET"): Promise<{
  statusCode: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function startVehicleServer(): Promise<{ server: Server; port: number }> {
  const app = express();
  app.use(vehiclePageRouter);
  const server = createServer(app);
  return { server, port: await listenLocal(server) };
}

test("real target VIN route returns a useful persisted SSR page through healthy, 429, timeout, and 5xx upstream states without requests", async (t) => {
  for (const upstreamState of ["healthy", "429 quota", "timeout", "5xx"] as const) {
    await t.test(upstreamState, async () => {
      const restoreDb = installDatabaseRows([targetRecord]);
      const { value, counts } = await withNetworkGuards(async () => {
        const { server, port } = await startVehicleServer();
        try {
          return await localRequest(port, `/vehicle/${TARGET_VIN}`);
        } finally {
          await closeLocal(server);
        }
      });
      restoreDb();
      assert.equal(value.statusCode, 200);
      assert.match(value.body, /2025 Cadillac Escalade IQ Luxury2/);
      assert.match(value.body, /72,500/); // synthetic fixture value
      assert.match(value.body, /1,250 miles/); // synthetic fixture value
      assert.match(value.body, /rel="canonical" href="https:\/\/www\.autonegotiating\.com\/vehicle\/1GYTEDKL5SU107838"/);
      assert.match(value.body, /"@type"\s*:\s*"Vehicle"/);
      assert.match(value.body, /"@type"\s*:\s*"Offer"/);
      assert.deepEqual(counts, { fetchCalls: 0, undiciCalls: 0 });
    });
  }
});

test("default persisted lookup compiles active, freshness, VIN, make, and model constraints", async () => {
  capturedSql.length = 0;
  capturedParams.length = 0;
  const restoreDb = installDatabaseRows([targetRecord]);
  try {
    const record = await findQualifiedPersistedVehicle(TARGET_VIN);
    assert.equal(record?.vin, TARGET_VIN);
    assert.equal(capturedSql.length, 1);
    assert.match(capturedSql[0], /active_inventory.*vin/);
    assert.match(capturedSql[0], /active_inventory.*active/);
    assert.match(capturedSql[0], /last_seen/);
    assert.match(capturedSql[0], /make/);
    assert.match(capturedSql[0], /model/);
    assert.ok(capturedParams[0].includes(true));
    assert.ok(capturedParams[0].some((param) =>
      param instanceof Date || (typeof param === "string" && /^\d{4}-\d\d-\d\dT/.test(param)),
    ));
  } finally {
    restoreDb();
  }
});

test("inactive and stale persisted records resolve as deterministic 404s", async () => {
  for (const invalidRow of [
    { ...targetRecord, active: false },
    { ...targetRecord, lastSeen: new Date(Date.now() - (INVENTORY_FRESHNESS_DAYS + 1) * 86_400_000) },
  ]) {
    const restoreDb = installDatabaseRows([invalidRow]);
    const { value, counts } = await withNetworkGuards(async () => {
      const { server, port } = await startVehicleServer();
      try {
        return await localRequest(port, `/vehicle/${TARGET_VIN}`);
      } finally {
        await closeLocal(server);
      }
    });
    restoreDb();
    assert.equal(value.statusCode, 404);
    assert.deepEqual(counts, { fetchCalls: 0, undiciCalls: 0 });
  }
});

test("unknown and invalid VINs return 404 without external calls; lowercase VIN preserves 301", async () => {
  const restoreDb = installDatabaseRows([]);
  const { value, counts } = await withNetworkGuards(async () => {
    const { server, port } = await startVehicleServer();
    try {
      return {
        unknown: await localRequest(port, "/vehicle/1C4HJXDN6LW114178"),
        invalid: await localRequest(port, "/vehicle/1GYTEDKL5SU10783I"),
        lowercase: await localRequest(port, `/vehicle/${TARGET_VIN.toLowerCase()}`),
      };
    } finally {
      await closeLocal(server);
    }
  });
  restoreDb();
  assert.equal(value.unknown.statusCode, 404);
  assert.equal(value.invalid.statusCode, 404);
  assert.equal(value.lowercase.statusCode, 301);
  assert.equal(value.lowercase.headers.location, `/vehicle/${TARGET_VIN}`);
  assert.deepEqual(counts, { fetchCalls: 0, undiciCalls: 0 });
});

test("real Express HEAD response is bodyless and performs no external request", async () => {
  const restoreDb = installDatabaseRows([targetRecord]);
  const { value, counts } = await withNetworkGuards(async () => {
    const { server, port } = await startVehicleServer();
    try {
      return await localRequest(port, `/vehicle/${TARGET_VIN}`, "HEAD");
    } finally {
      await closeLocal(server);
    }
  });
  restoreDb();
  assert.equal(value.statusCode, 200);
  assert.equal(value.body, "");
  assert.ok(Number(value.headers["content-length"]) > 0);
  assert.deepEqual(counts, { fetchCalls: 0, undiciCalls: 0 });
});

test("missing optional image and source URL stay absent from rendered HTML and JSON-LD", async () => {
  const restoreDb = installDatabaseRows([targetRecord]);
  const { value } = await withNetworkGuards(async () => {
    const { server, port } = await startVehicleServer();
    try {
      return await localRequest(port, `/vehicle/${TARGET_VIN}`);
    } finally {
      await closeLocal(server);
    }
  });
  restoreDb();
  assert.equal(value.statusCode, 200);
  assert.doesNotMatch(value.body, /<img\b/);
  assert.doesNotMatch(value.body, /href="https:\/\/www\.auto\.dev/);
  const jsonLd = value.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd);
  const graph = JSON.parse(jsonLd!);
  assert.equal("image" in graph["@graph"][0], false);
  assert.equal("image" in graph["@graph"][1], false);
});

test("renderer marks absent price, mileage, dealer, year, trim, and condition as unknown", () => {
  const html = renderVehiclePage({
    vin: TARGET_VIN,
    make: "Cadillac",
    model: "Escalade IQ",
    year: null,
    trim: null,
    condition: null,
    price: null,
    mileage: null,
    dealerName: null,
    city: null,
    state: null,
    sourceUrl: null,
  }, TARGET_VIN);
  assert.match(html, /Price not provided/);
  assert.match(html, /Mileage not provided/);
  assert.match(html, /Dealer name not provided/);
  assert.match(html, /<dt>Year<\/dt><dd>Not provided<\/dd>/);
  assert.match(html, /<dt>Trim<\/dt><dd>Not provided<\/dd>/);
  assert.match(html, /<dt>Condition<\/dt><dd>Not provided<\/dd>/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd);
  const graph = JSON.parse(jsonLd!);
  const vehicle = graph["@graph"][0];
  const offer = vehicle.offers;
  assert.equal("vehicleModelDate" in vehicle, false);
  assert.equal("vehicleConfiguration" in vehicle, false);
  assert.equal("mileageFromOdometer" in vehicle, false);
  assert.equal("itemCondition" in vehicle, false);
  assert.equal("price" in offer, false);
  assert.equal("priceCurrency" in offer, false);
  assert.equal("itemCondition" in offer, false);
  assert.equal("seller" in offer, false);
});

test("Auto.dev source URLs are not labeled as original dealer listings", () => {
  const html = renderVehiclePage({
    ...targetRecord,
    dealerListingUrl: "https://www.auto.dev/listings/example",
  }, TARGET_VIN);
  assert.match(html, /View source listing/);
  assert.doesNotMatch(html, /View original dealer listing/);
});
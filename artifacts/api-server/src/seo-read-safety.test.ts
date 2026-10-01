import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import http from "node:http";
import { db } from "@workspace/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "undici";
import seoRouter from "./routes/seo";
import { indexInventoryListings } from "./lib/inventory-index";

// Only synthetic in-memory results. No PostgreSQL connection is made.
const rows = [0, 1, 2].map((index) => ({
  vin: `1GYTEDKL5SU${String(107838 + index)}`,
  year: 2024, make: "BMW", model: "5 Series", trim: "M550i",
  price: 40_000, mileage: 10_000, dealerName: "Fixture Motors",
  condition: "used", dealerCity: "Portland", dealerState: "OR", sourceUrl: null,
  lastSeen: new Date(), updatedAt: new Date(), firstSeen: new Date(), active: true,
  count: 3, totalCount: 3, years: [2024], usedCount: 3, newCount: 0,
}));

function installBoundaries(allowLifecycle = false) {
  const counters = { reads: 0, writes: 0, maintenance: 0, schedules: 0, upstream: 0 };
  const originals = ["select", "insert", "update", "delete"].map((name) => [
    name, Object.getOwnPropertyDescriptor(db, name),
  ] as const);
  const originalTimer = globalThis.setTimeout;
  const originalFetch = globalThis.fetch;
  const originalRequest = Pool.prototype.request;
  function chain(value: unknown, onWhere?: (condition: any) => void): any {
    const builder = new Proxy({}, {
      get(_object, property) {
        if (property === "then") return Promise.resolve(value).then.bind(Promise.resolve(value));
        return (...args: any[]) => {
          if (property === "where") onWhere?.(args[0]);
          return builder;
        };
      },
    });
    return builder;
  }
  Object.defineProperty(db, "select", { configurable: true, value: () => {
    counters.reads += 1;
    return chain(rows);
  } });
  for (const method of ["insert", "update", "delete"]) {
    Object.defineProperty(db, method, { configurable: true, value: () => {
      counters.writes += 1;
      if (!allowLifecycle) throw new Error("A public SEO read attempted a database write");
      if (method === "update") {
        counters.maintenance += 1;
        return chain([{ vin: rows[0].vin, make: "BMW", model: "5 Series" }], (condition) => {
          const query = new PgDialect().sqlToQuery(condition);
          assert.match(query.sql, /"active_inventory"\."active"/);
          assert.match(query.sql, /"active_inventory"\."last_seen"\s*</);
        });
      }
      return chain([]);
    } });
  }
  globalThis.setTimeout = ((..._args: unknown[]) => {
    counters.schedules += 1;
    if (!allowLifecycle) throw new Error("A public SEO read scheduled an IndexNow submission");
    // Deliberately never invoke the callback or submit IndexNow.
    return {} as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.fetch = (async () => {
    counters.upstream += 1;
    throw new Error("External fetch is forbidden in this fixture");
  }) as typeof fetch;
  Pool.prototype.request = (async () => {
    counters.upstream += 1;
    throw new Error("External Auto.dev request is forbidden in this fixture");
  }) as typeof Pool.prototype.request;
  return { counters, restore() {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(db, name, original);
      else delete (db as any)[name];
    }
    globalThis.setTimeout = originalTimer;
    globalThis.fetch = originalFetch;
    Pool.prototype.request = originalRequest;
  } };
}

function read(port: number, path: string, method: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method, agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("real sitemap, directory, Phase 2/3A/3B GET and HEAD routes never write or schedule IndexNow", async () => {
  const app = express();
  app.use(seoRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const boundary = installBoundaries();
  try {
    for (const method of ["GET", "HEAD"]) {
      for (const path of [
        "/sitemap.xml", "/sitemap-static.xml", "/sitemap-vehicles/1.xml", "/cars",
        "/cars/bmw/5-series", "/cars/bmw/m550i", "/cars/bmw/m550i/2024",
      ]) {
        const result = await read(port, path, method);
        assert.equal(result.status, 200, `${method} ${path}`);
        if (method === "HEAD") assert.equal(result.body, "");
      }
    }
    assert.ok(boundary.counters.reads > 0);
    assert.equal(boundary.counters.writes, 0);
    assert.equal(boundary.counters.schedules, 0);
    assert.equal(boundary.counters.upstream, 0);
  } finally {
    boundary.restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("successful upstream ingestion still performs stale maintenance and queues genuine lifecycle changes", async () => {
  const boundary = installBoundaries(true);
  try {
    indexInventoryListings([{
      vin: rows[1].vin, year: 2024, make: "BMW", model: "5 Series", trim: "M550i",
      price: 41_000, mileage: 10_000,
    }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(boundary.counters.maintenance, 1);
    assert.equal(boundary.counters.writes, 2, "one stale deactivation plus one upstream upsert");
    assert.ok(boundary.counters.schedules > 0, "genuine changes still enqueue IndexNow");
    assert.equal(boundary.counters.upstream, 0, "tests do not submit notifications or search Auto.dev");
  } finally {
    boundary.restore();
  }
});
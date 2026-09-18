import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveInventory, InsertActiveInventory } from "@workspace/db";
import { sluggedInventoryGroups } from "./lib/cars-slugs";
import {
  chunkUrls,
  dedupeRecentUrls,
  submitIndexNow,
  submitIndexNowSafely,
} from "./lib/indexnow";
import {
  hasMaterialInventoryChange,
  inventoryChangeKind,
  inventoryRowsRequiringNotification,
  inventoryUrls,
} from "./lib/inventory-index";

const baseListing: Partial<InsertActiveInventory> = {
  vin: "1C4HJXDN6LW114178",
  year: 2020,
  make: "Jeep",
  model: "Wrangler",
  trim: "Sport",
  condition: "used",
  price: 30_000,
  mileage: 40_000,
  dealerName: "Example Motors",
  dealerCity: "Portland",
  dealerState: "OR",
  sourceUrl: "https://www.auto.dev/listing/example",
};

test("material inventory classification ignores observation timestamps", () => {
  const previous = {
    ...baseListing,
    active: true,
    firstSeen: new Date("2026-01-01"),
    lastSeen: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as ActiveInventory;
  assert.equal(hasMaterialInventoryChange(undefined, baseListing), true);
  assert.equal(hasMaterialInventoryChange(previous, {
    ...baseListing,
    lastSeen: new Date("2026-02-01"),
    updatedAt: new Date("2026-02-01"),
  }), false);
  assert.equal(hasMaterialInventoryChange(previous, { ...baseListing, price: 29_500 }), true);
  assert.equal(inventoryChangeKind(undefined, baseListing), "new");
  assert.equal(inventoryChangeKind(previous, baseListing), null);
  assert.equal(inventoryChangeKind(previous, { ...baseListing, price: 29_500 }), "material");
  assert.equal(inventoryChangeKind({ ...previous, active: false }, baseListing), "reactivated");
});

test("notification selection includes new, material, and reactivated rows only", () => {
  const unchanged = { ...baseListing, vin: "11111111111111111" } as InsertActiveInventory;
  const material = { ...baseListing, vin: "22222222222222222", price: 28_000 } as InsertActiveInventory;
  const reactivated = { ...baseListing, vin: "33333333333333333" } as InsertActiveInventory;
  const discovered = { ...baseListing, vin: "44444444444444444" } as InsertActiveInventory;
  const previous = new Map<string, Partial<ActiveInventory>>([
    [unchanged.vin, { ...unchanged, active: true }],
    [material.vin, { ...material, price: 30_000, active: true }],
    [reactivated.vin, { ...reactivated, active: false }],
  ]);
  assert.deepEqual(
    inventoryRowsRequiringNotification(
      [unchanged, material, reactivated, discovered],
      previous,
    ).map((row) => row.vin),
    [material.vin, reactivated.vin, discovered.vin],
  );
});

test("IndexNow batches contain at most 10,000 unique canonical URLs", () => {
  const urls = Array.from(
    { length: 10_001 },
    (_, index) => `https://www.autonegotiating.com/vehicle/${String(index).padStart(17, "0")}`,
  );
  const batches = chunkUrls([...urls, urls[0]]);
  assert.deepEqual(batches.map((batch) => batch.length), [10_000, 1]);
});

test("short-period URL dedupe accepts a URL again after its TTL", () => {
  const recent = new Map<string, number>();
  const url = "https://www.autonegotiating.com/vehicle/1C4HJXDN6LW114178";
  assert.deepEqual(dedupeRecentUrls([url, url], recent, 1_000, 5_000), [url]);
  assert.deepEqual(dedupeRecentUrls([url], recent, 2_000, 5_000), []);
  assert.deepEqual(dedupeRecentUrls([url], recent, 6_000, 5_000), [url]);
});

test("directory notifications reuse canonical slug behavior", () => {
  const groups = [{ make: "BMW", model: "5 Series", count: 1 }];
  const [slugged] = sluggedInventoryGroups(groups);
  assert.equal(slugged.makeSlug, "bmw");
  assert.equal(slugged.modelSlug, "5-series");
  assert.ok(inventoryUrls([], groups, groups).includes(
    "https://www.autonegotiating.com/cars/bmw/5-series",
  ));
  assert.deepEqual(
    inventoryUrls(["1C4HJXDN6LW114178"], groups, groups),
    [
      "https://www.autonegotiating.com/vehicle/1C4HJXDN6LW114178",
      "https://www.autonegotiating.com/cars/bmw/5-series",
    ],
  );
});

test("old and new colliding directory names resolve in separate group universes", () => {
  const oldGroup = [{ make: "Example", model: "A+B", count: 1 }];
  const newGroup = [{ make: "Example", model: "A Plus B", count: 1 }];
  assert.deepEqual(inventoryUrls([], oldGroup, oldGroup), [
    "https://www.autonegotiating.com/cars/example/a-plus-b",
  ]);
  assert.deepEqual(inventoryUrls([], newGroup, newGroup), [
    "https://www.autonegotiating.com/cars/example/a-plus-b",
  ]);
});

test("safe submission absorbs IndexNow rejection", async () => {
  const previousKey = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = "test-indexnow-key";
  try {
    const accepted = await submitIndexNowSafely(
      ["https://www.autonegotiating.com/vehicle/1C4HJXDN6LW114178"],
      async () => new Response("", { status: 503 }),
    );
    assert.equal(accepted, false);
  } finally {
    if (previousKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = previousKey;
  }
});

test("submission sends the official JSON shape and accepts HTTP 202", async () => {
  const previousKey = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = "test-indexnow-key";
  let requestBody: Record<string, unknown> | undefined;
  try {
    const statuses = await submitIndexNow(
      ["https://www.autonegotiating.com/vehicle/1C4HJXDN6LW114178"],
      async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response("", { status: 202 });
      },
    );
    assert.deepEqual(statuses, [202]);
    assert.deepEqual(requestBody, {
      host: "www.autonegotiating.com",
      key: "test-indexnow-key",
      keyLocation: "https://www.autonegotiating.com/test-indexnow-key.txt",
      urlList: ["https://www.autonegotiating.com/vehicle/1C4HJXDN6LW114178"],
    });
  } finally {
    if (previousKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = previousKey;
  }
});

test("a failed IndexNow batch does not prevent later batches", async () => {
  const previousKey = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = "test-indexnow-key";
  const urls = Array.from(
    { length: 10_001 },
    (_, index) => `https://www.autonegotiating.com/vehicle/${String(index).padStart(17, "0")}`,
  );
  let calls = 0;
  try {
    await assert.rejects(
      submitIndexNow(urls, async () => {
        calls += 1;
        return new Response("", { status: calls === 1 ? 503 : 202 });
      }),
      /1 IndexNow batch submission/,
    );
    assert.equal(calls, 2);
  } finally {
    if (previousKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = previousKey;
  }
});
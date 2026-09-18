import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveInventory, InsertActiveInventory } from "@workspace/db";
import {
  modelFamilySitemapUrls,
  resolveInventoryGroup,
  sluggedInventoryGroups,
} from "./lib/cars-slugs";
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

test("case-only model-family variants aggregate under one deterministic canonical", () => {
  const groups = sluggedInventoryGroups([
    { make: "BMW", model: "5 series", count: 7 },
    { make: "BMW", model: "5 Series", count: 11 },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].make, "BMW");
  assert.equal(groups[0].model, "5 Series");
  assert.equal(groups[0].count, 18);
  assert.equal(groups[0].modelSlug, "5-series");
  assert.deepEqual(new Set(groups[0].legacyModelSlugs), new Set([
    "5-series-want4r",
    "5-series-cuovff",
  ]));
  assert.deepEqual(resolveInventoryGroup(groups, "bmw", "5-series"), {
    group: groups[0], redirect: false,
  });
  assert.deepEqual(resolveInventoryGroup(groups, "bmw", "5-series-want4r"), {
    group: groups[0], redirect: true,
  });
  assert.deepEqual(resolveInventoryGroup(groups, "bmw", "5-series-cuovff"), {
    group: groups[0], redirect: true,
  });
});

test("genuine normalized-slug collisions remain deterministically suffixed", () => {
  const groups = sluggedInventoryGroups([
    { make: "Example", model: "A+B", count: 2 },
    { make: "Example", model: "A Plus B", count: 3 },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(new Set(groups.map((group) => group.modelSlug)).size, 2);
  assert.ok(groups.every((group) => group.modelSlug.startsWith("a-plus-b-")));
  assert.equal(resolveInventoryGroup(groups, "example", "a-plus-b"), undefined);
});

test("case-only family variants generate one canonical IndexNow URL", () => {
  const groups = [
    { make: "BMW", model: "5 series", count: 7 },
    { make: "BMW", model: "5 Series", count: 11 },
  ];
  assert.deepEqual(inventoryUrls([], groups, groups), [
    "https://www.autonegotiating.com/cars/bmw/5-series",
  ]);
});

test("an ordinary 8 Series family remains canonical and independent of Phase 3A thresholds", () => {
  const [group] = sluggedInventoryGroups([
    { make: "BMW", model: "8 Series", count: 1 },
  ]);
  assert.equal(group.modelSlug, "8-series");
  assert.equal(group.count, 1);
  assert.deepEqual(group.legacyModelSlugs, []);
});

test("model-family sitemap emits qualifying canonical URLs once and excludes legacy aliases", () => {
  const urls = modelFamilySitemapUrls([
    { make: "BMW", model: "5 series", count: 1 },
    { make: "BMW", model: "5 Series", count: 159 },
    { make: "BMW", model: "8 Series", count: 208 },
    { make: "BMW", model: "3 Series", count: 0 },
    { make: "BMW", model: "8 Series", count: 0 },
  ]);
  assert.deepEqual(urls, [
    "https://www.autonegotiating.com/cars/bmw/5-series",
    "https://www.autonegotiating.com/cars/bmw/8-series",
  ]);
  assert.ok(!urls.some((url) => url.includes("want4r") || url.includes("cuovff")));
  assert.equal(urls.length, new Set(urls).size);
});

test("model-family sitemap preserves resolved canonical slugs for genuine collisions", () => {
  const urls = modelFamilySitemapUrls([
    { make: "Example", model: "A+B", count: 2 },
    { make: "Example", model: "A Plus B", count: 3 },
  ]);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => /\/cars\/example\/a-plus-b-[a-z0-9]+$/.test(url)));
  assert.equal(urls.length, new Set(urls).size);
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
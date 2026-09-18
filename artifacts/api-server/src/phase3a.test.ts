import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE3A_ENTITIES,
  PHASE3A_MIN_VEHICLES,
  findPhase3aEntity,
  phase3aEntityForInventory,
  phase3aNotificationUrls,
  renderPhase3aPage,
  isPhase3aIndexable,
  isPhase3aInventoryQualifying,
  suppressPhase3aModelCollisions,
  validatePhase3aRegistry,
  phase3aAffectedEntityUrls,
  phase3aCanonicalPath,
  phase3aSitemapUrls,
  phase3aEntityPageDecision,
  phase3aNotificationPlan,
  type Phase3aEntitySummary,
  PHASE3A_PAGE_SIZE,
} from "./lib/phase3a";

const vehicle = (trim: string) => ({
  vin: "1C4HJXDN6LW114178",
  year: 2024,
  make: "BMW",
  model: "5 Series",
  trim,
  condition: "used",
  price: 50_000,
  mileage: 10_000,
  dealerName: "Example Motors",
  dealerCity: "Portland",
  dealerState: "OR",
  sourceUrl: "https://auto.dev/listing/example",
  active: true,
  lastSeen: new Date(),
  updatedAt: new Date(),
  firstSeen: new Date(),
});

test("registry contains exactly the six validated BMW shopper entities", () => {
  assert.deepEqual(PHASE3A_ENTITIES.map((entity) => entity.slug), ["530i", "540i", "m550i", "m340i", "840i", "m850i"]);
  assert.equal(PHASE3A_ENTITIES.find((entity) => entity.slug === "m550i")?.trims[0], "M550i xDrive");
  assert.equal(PHASE3A_ENTITIES.find((entity) => entity.slug === "840i")?.trims.includes("840i Gran Coupe"), true);
});

test("each initial entity uses the expected model family", () => {
  assert.deepEqual(PHASE3A_ENTITIES.map((entity) => entity.model), [
    "5 Series", "5 Series", "5 Series", "3 Series", "8 Series", "8 Series",
  ]);
});

test("530i explicitly accepts both approved raw variants", () => {
  assert.equal(phase3aEntityForInventory(vehicle("530i"))?.slug, "530i");
  assert.equal(phase3aEntityForInventory(vehicle("530i xDrive"))?.slug, "530i");
});

test("M340i explicitly accepts both approved raw variants", () => {
  const row = { ...vehicle("M340i"), model: "3 Series" };
  assert.equal(phase3aEntityForInventory(row)?.slug, "m340i");
  assert.equal(phase3aEntityForInventory({ ...row, trim: "M340i xDrive" })?.slug, "m340i");
});

test("840i only accepts its curated static variants", () => {
  const row = { ...vehicle("840i"), model: "8 Series" };
  assert.equal(phase3aEntityForInventory(row)?.slug, "840i");
  assert.equal(phase3aEntityForInventory({ ...row, trim: "840i Gran Coupe" })?.slug, "840i");
  assert.equal(phase3aEntityForInventory({ ...row, trim: "840i AWD" })?.slug, undefined);
});

test("approved raw variants map to one entity without suffix stripping", () => {
  assert.equal(phase3aEntityForInventory(vehicle("540i"))?.slug, "540i");
  assert.equal(phase3aEntityForInventory(vehicle("540i xDrive"))?.slug, "540i");
  assert.equal(phase3aEntityForInventory(vehicle("M550i"))?.slug, undefined);
  assert.equal(phase3aEntityForInventory(vehicle("M550i xDrive"))?.slug, "m550i");
});

test("registry rejects duplicate and unvalidated mappings", () => {
  assert.equal(validatePhase3aRegistry([
    { ...PHASE3A_ENTITIES[0], slug: "duplicate" },
    { ...PHASE3A_ENTITIES[0], slug: "duplicate" },
    { ...PHASE3A_ENTITIES[0], trims: ["not-a-static-trim"] },
  ]).length, 1);
});

test("model-family collisions and reused raw trim labels are suppressed", () => {
  const conflicting = { ...PHASE3A_ENTITIES[0], slug: "m5" };
  assert.equal(suppressPhase3aModelCollisions([conflicting], [{ make: "BMW", model: "m5" }, { make: "BMW", model: "5-series" }]).length, 0);
  assert.equal(validatePhase3aRegistry([
    { ...PHASE3A_ENTITIES[0], slug: "first" },
    { ...PHASE3A_ENTITIES[0], slug: "second" },
  ]).length, 1);
});

test("model-family slug resolution takes priority over SEO entity", () => {
  assert.equal(findPhase3aEntity("BMW", "m550i")?.name, "BMW M550i");
  assert.equal(findPhase3aEntity("BMW", "m5"), undefined);
});

test("canonical entity paths are normalized and never expose raw trim suffixes", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "m550i")!;
  assert.equal(phase3aCanonicalPath(entity), "/cars/bmw/m550i");
  assert.equal(entity.trims[0], "M550i xDrive");
});

test("entity route decision redirects aliases and 404s below threshold or out-of-range pages", () => {
  const entity = PHASE3A_ENTITIES[1];
  assert.deepEqual(phase3aEntityPageDecision("/cars/BMW/540I", entity, 2, 1), {
    kind: "redirect", location: "/cars/bmw/540i",
  });
  assert.deepEqual(phase3aEntityPageDecision("/cars/bmw/540i", entity, 1, 1), { kind: "not-found" });
  assert.deepEqual(phase3aEntityPageDecision("/cars/BMW/540I", entity, 1, 1), { kind: "not-found" });
  assert.deepEqual(phase3aEntityPageDecision("/cars/bmw/540i", entity, 101, 2), {
    kind: "render", offset: PHASE3A_PAGE_SIZE,
  });
  assert.deepEqual(phase3aEntityPageDecision("/cars/bmw/540i", entity, 101, 3), { kind: "not-found" });
});

test("threshold transitions notify only entities that are or become indexable", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const id = `bmw\0${entity.slug}`;
  assert.deepEqual(phase3aNotificationUrls(new Map([[id, false]]), new Map([[id, true]]), [entity]), [
    "https://www.autonegotiating.com/cars/bmw/540i",
  ]);
  assert.deepEqual(phase3aNotificationUrls(new Map([[id, false]]), new Map([[id, false]]), [entity]), []);
  assert.equal(PHASE3A_MIN_VEHICLES, 2);
  assert.equal(isPhase3aIndexable(0), false);
  assert.equal(isPhase3aIndexable(1), false);
  assert.equal(isPhase3aIndexable(2), true);
});

test("threshold-down and material changes notify the canonical entity", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const id = `bmw\0${entity.slug}`;
  assert.deepEqual(phase3aNotificationUrls(new Map([[id, true]]), new Map([[id, false]]), [entity]), [
    "https://www.autonegotiating.com/cars/bmw/540i",
  ]);
  assert.deepEqual(phase3aNotificationUrls(new Map([[id, true]]), new Map([[id, true]]), [entity]), [
    "https://www.autonegotiating.com/cars/bmw/540i",
  ]);
});

test("unchanged below-threshold observations produce no entity URL", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const id = `bmw\0${entity.slug}`;
  assert.deepEqual(phase3aNotificationUrls(new Map([[id, false]]), new Map([[id, false]]), [entity]), []);
});

test("notification plan degrades safely when either bookkeeping state read fails", () => {
  const entity = PHASE3A_ENTITIES[1];
  const id = `bmw\0${entity.slug}`;
  assert.deepEqual(phase3aNotificationPlan(undefined, new Map([[id, true]]), [entity]), []);
  assert.deepEqual(phase3aNotificationPlan(new Map([[id, true]]), undefined, [entity]), []);
  assert.deepEqual(phase3aNotificationPlan(new Map([[id, false]]), new Map([[id, true]]), [entity]), [
    "https://www.autonegotiating.com/cars/bmw/540i",
  ]);
});

test("stale deactivation always queues affected approved entity URLs", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  assert.deepEqual(phase3aAffectedEntityUrls([entity]), ["https://www.autonegotiating.com/cars/bmw/540i"]);
});

test("inactive and stale rows do not qualify for Phase 3A", () => {
  const now = Date.now();
  const base = { vin: "1C4HJXDN6LW114178", make: "BMW", model: "5 Series", active: true, lastSeen: new Date(now) };
  assert.equal(isPhase3aInventoryQualifying(base, now), true);
  assert.equal(isPhase3aInventoryQualifying({ ...base, active: false }, now), false);
  assert.equal(isPhase3aInventoryQualifying({ ...base, lastSeen: new Date(now - 31 * 86_400_000) }, now), false);
});

test("sitemap helper includes qualifying entities and excludes suppressed ones", () => {
  const states = new Map(PHASE3A_ENTITIES.map((entity) => [`bmw\0${entity.slug}`, entity.slug === "540i"]));
  assert.deepEqual(phase3aSitemapUrls(PHASE3A_ENTITIES, states, [{ make: "BMW", model: "540i" }]), []);
  assert.deepEqual(phase3aSitemapUrls(PHASE3A_ENTITIES, states), ["https://www.autonegotiating.com/cars/bmw/540i"]);
});

test("SSR page contains inventory, canonical vehicle links, metadata, breadcrumbs, and valid JSON-LD", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const html = renderPhase3aPage(entity, [vehicle("540i"), { ...vehicle("540i xDrive"), vin: "JH4TB2H26CC000001" }]);
  assert.match(html, /BMW 540i for Sale/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/540i"/);
  assert.match(html, /\/vehicle\/1C4HJXDN6LW114178/);
  assert.match(html, /540i xDrive/);
  assert.match(html, /https:\/\/www\.autonegotiating\.com\/cars\/bmw\/5-series/);
  assert.match(html, /application\/ld\+json/);
  const json = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
  assert.doesNotThrow(() => JSON.parse(json!));
});

test("SSR title is neutral for mixed new and used inventory", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const html = renderPhase3aPage(entity, [vehicle("540i"), { ...vehicle("540i xDrive"), condition: "new" }]);
  assert.match(html, /<title>BMW 540i for Sale \| AutoNegotiating<\/title>/);
});

test("SSR title says Used only when all listings are used", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const html = renderPhase3aPage(entity, [vehicle("540i"), { ...vehicle("540i xDrive"), vin: "JH4TB2H26CC000001" }]);
  assert.match(html, /<title>Used BMW 540i for Sale \| AutoNegotiating<\/title>/);
});

test("SSR title says New only when all listings are new", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const html = renderPhase3aPage(entity, [{ ...vehicle("540i"), condition: "new" }, { ...vehicle("540i xDrive"), vin: "JH4TB2H26CC000001", condition: "new" }]);
  assert.match(html, /<title>New BMW 540i for Sale \| AutoNegotiating<\/title>/);
});

test("JSON-LD is safely escaped and uses one graph with one ItemList", () => {
  const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
  const html = renderPhase3aPage(entity, [{ ...vehicle("540i <script>"), condition: "used" }, { ...vehicle("540i xDrive"), vin: "JH4TB2H26CC000001" }]);
  assert.match(html, /\\u003cscript\\u003e/);
  assert.equal((html.match(/"@type":"ItemList"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<\/script><script>/);
});

test("SSR reports total count but renders only the displayed page rows", () => {
  const entity = PHASE3A_ENTITIES[1];
  const html = renderPhase3aPage(entity, [vehicle("540i")], 205, 2);
  assert.match(html, /205 qualifying vehicles/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/540i\?page=2"/);
  assert.match(html, /BMW 540i for Sale — Page 2 \| AutoNegotiating/);
  assert.match(html, /"position":101/);
  assert.match(html, /href="\/cars\/bmw\/540i\?page=1"/);
  assert.match(html, /href="\/cars\/bmw\/540i\?page=3"/);
  assert.equal((html.match(/<article>/g) ?? []).length, 1);
});

test("SSR page two uses whole-entity summary for years, title, canonical and positions", () => {
  const entity = PHASE3A_ENTITIES[1];
  const summary: Phase3aEntitySummary = {
    totalCount: 205, years: [2023, 2024], allUsed: true, allNew: false,
  };
  const html = renderPhase3aPage(entity, [vehicle("540i")], 205, 2, summary);
  assert.match(html, /Browse 205 current BMW 540i listings.*model years 2023, 2024/);
  assert.match(html, /<title>Used BMW 540i for Sale — Page 2 \| AutoNegotiating<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/540i\?page=2"/);
  assert.match(html, /"position":101/);
});
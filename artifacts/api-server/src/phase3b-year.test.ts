import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE3B_STAT_MIN_OBSERVATIONS,
  PHASE3B_YEAR_MIN_VEHICLES,
  phase3bYearEntity,
  phase3bYearCandidatesBeforeStaleDeactivation,
  phase3bYearCandidatesForRows,
  phase3bYearNotificationUrls,
  phase3bYearPageDecision,
  phase3bYearPath,
  phase3bYearSitemapUrls,
  phase3bYearSummary,
  isSupportedPhase3bYearNumber,
  renderPhase3bYearPage,
} from "./lib/phase3b-year";
import {
  PHASE3A_ENTITIES,
  phase3aEntityForInventory,
  phase3aEntityUrl,
} from "./lib/phase3a";
import { modelFamilySitemapUrls } from "./lib/cars-slugs";

const entity = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "540i")!;
const m550i = PHASE3A_ENTITIES.find((candidate) => candidate.slug === "m550i")!;
const candidate = { entity, year: 2023 };
const row = (trim: string, vin: string, price = 30_000, mileage = 10_000, year = 2023) => ({
  vin, year, make: "BMW", model: "5 Series", trim, price, mileage,
  condition: "used", dealerName: "Example Motors", dealerCity: "Portland", dealerState: "OR",
  active: true, lastSeen: new Date(), firstSeen: new Date(), updatedAt: new Date(),
});
const id = (year = 2023) => `bmw\0${entity.slug}\0${year}`;

test("registry mapping is exact and case-insensitive", () => {
  assert.equal(phase3bYearEntity("bMw", "540I", "2023")?.entity, entity);
  assert.equal(phase3aEntityForInventory(row("540i", "1C4HJXDN6LW114178"))?.slug, "540i");
  assert.equal(phase3bYearEntity("BMW", "not-curated", "2023"), undefined);
  assert.equal(phase3bYearEntity("BMW", "540i", "2023")?.year, 2023);
});

test("multiple approved raw trims aggregate under one year/entity identity", () => {
  const mapped = [
    phase3aEntityForInventory(row("540i", "1C4HJXDN6LW114178")),
    phase3aEntityForInventory(row("540i xDrive", "JH4TB2H26CC000001")),
  ];
  assert.deepEqual(mapped.map((value) => value?.slug), ["540i", "540i"]);
  assert.equal(new Set(mapped.map((value) => value?.slug)).size, 1);
});

test("M550i requires its explicit approved raw trim", () => {
  assert.equal(phase3aEntityForInventory({ make: "BMW", model: "5 Series", trim: "M550i xDrive" })?.slug, "m550i");
  assert.equal(phase3aEntityForInventory({ make: "BMW", model: "5 Series", trim: "M550i" }), undefined);
  assert.equal(phase3bYearEntity("BMW", "m550i", "2023")?.entity, m550i);
});

test("all threshold transitions have the required indexability behavior", () => {
  assert.equal(PHASE3B_YEAR_MIN_VEHICLES, 3);
  const expected = [false, false, false, true, true, true, false, true];
  const counts = [0, 1, 2, 3, 4, 3, 2, 3];
  assert.deepEqual(counts.map((count) =>
    phase3bYearPageDecision(phase3bYearPath(entity, 2023), candidate, count, 1).kind === "render"), expected);
});

test("invalid, unsupported, and state-like dimensions remain unavailable", () => {
  for (const dimension of ["23", "2023x", "oregon", "OR", "0000", "1885"]) {
    assert.equal(phase3bYearEntity("BMW", "540i", dimension), undefined, dimension);
  }
  assert.equal(phase3bYearEntity("BMW", "540i", String(new Date().getUTCFullYear() + 3)), undefined);
  assert.equal(isSupportedPhase3bYearNumber(2023), true);
  assert.equal(isSupportedPhase3bYearNumber(2023.5), false);
});

test("year candidate and sitemap/notification helpers reject unroutable years", () => {
  const invalidRows = [
    row("540i", "1C4HJXDN6LW114178", 30_000, 10_000, 1885),
    row("540i", "JH4TB2H26CC000001", 30_000, 10_000, new Date().getUTCFullYear() + 3),
  ];
  assert.deepEqual(phase3bYearCandidatesForRows(invalidRows as never[]), []);
  assert.deepEqual(phase3bYearSitemapUrls([{ entity, year: 1885 }, { entity, year: 2023 }]), [
    "https://www.autonegotiating.com/cars/bmw/540i/2023",
  ]);
  assert.deepEqual(phase3bYearNotificationUrls(new Map(), new Map([["bad", true]]), [{ entity, year: 1885 }]), []);
});

test("stale transition candidates require three active pre-deactivation rows and at least one expiring row", () => {
  const cutoff = new Date("2026-07-01T00:00:00Z");
  const fresh = new Date("2026-06-30T00:00:00Z");
  const stale = new Date("2026-06-01T00:00:00Z");
  const qualifying = [
    { ...row("540i", "1C4HJXDN6LW114178"), active: true, lastSeen: stale },
    { ...row("540i xDrive", "JH4TB2H26CC000001"), active: true, lastSeen: fresh },
    { ...row("540i", "1C4HJXDN6LW114179"), active: true, lastSeen: fresh },
  ];
  const lone = [{ ...row("540i", "1C4HJXDN6LW114180"), active: true, lastSeen: stale }];
  const below = [
    { ...row("540i", "1C4HJXDN6LW114181"), active: true, lastSeen: stale },
    { ...row("540i", "JH4TB2H26CC000002"), active: true, lastSeen: fresh },
  ];
  assert.deepEqual(phase3bYearCandidatesBeforeStaleDeactivation(qualifying as never[], cutoff), [candidate]);
  assert.deepEqual(phase3bYearCandidatesBeforeStaleDeactivation(lone as never[], cutoff), []);
  assert.deepEqual(phase3bYearCandidatesBeforeStaleDeactivation(below as never[], cutoff), []);
});

test("page two metadata and CollectionPage name carry page context", () => {
  const html = renderPhase3bYearPage(candidate, [row("540i", "1C4HJXDN6LW114178")] as never[], 101, 2);
  assert.match(html, /<title>2023 BMW 540i for Sale — Page 2 \| AutoNegotiating<\/title>/);
  assert.match(html, /Page 2\./);
  assert.match(html, /"name":"2023 BMW 540i for Sale — Page 2"/);
});

test("canonical redirects, pagination offsets, and out-of-range pages are deterministic", () => {
  assert.deepEqual(phase3bYearPageDecision("/cars/BMW/540I/2023", candidate, 3, 1), {
    kind: "redirect", location: "/cars/bmw/540i/2023",
  });
  assert.deepEqual(phase3bYearPageDecision("/cars/bmw/540i/2023", candidate, 201, 2), {
    kind: "render", offset: 100,
  });
  assert.deepEqual(phase3bYearPageDecision("/cars/bmw/540i/2023", candidate, 200, 3), { kind: "not-found" });
  assert.deepEqual(phase3bYearPageDecision("/cars/bmw/540i/2023", candidate, 2, 1), { kind: "not-found" });
});

test("statistics enforce minimum observations and calculate deterministic medians", () => {
  const tooThin = phase3bYearSummary([
    row("540i", "1C4HJXDN6LW114178", 10_000, 0),
    row("540i xDrive", "JH4TB2H26CC000001", 30_000, 10_000),
  ] as never[]);
  assert.equal(PHASE3B_STAT_MIN_OBSERVATIONS, 3);
  assert.equal(tooThin.medianPrice, undefined);
  assert.equal(tooThin.medianMileage, undefined);
  const summary = phase3bYearSummary([
    row("540i", "1C4HJXDN6LW114178", 10_000, 0),
    row("540i xDrive", "JH4TB2H26CC000001", 0, 10_000),
    row("540i", "1C4HJXDN6LW114179", 30_000, 20_000),
    row("540i xDrive", "JH4TB2H26CC000002", 50_000, -1),
  ] as never[]);
  assert.equal(summary.priceCount, 3);
  assert.equal(summary.minPrice, 10_000);
  assert.equal(summary.maxPrice, 50_000);
  assert.equal(summary.medianPrice, 30_000);
  assert.equal(summary.mileageCount, 3);
  assert.equal(summary.medianMileage, 10_000);
});

test("SSR includes factual metadata, canonical vehicle links, backlinks, and valid JSON-LD", () => {
  const html = renderPhase3bYearPage(candidate, [
    row("540i", "1C4HJXDN6LW114178"),
    row("540i xDrive", "JH4TB2H26CC000001", 40_000, 20_000),
    row("540i", "1C4HJXDN6LW114179", 50_000, 30_000),
  ] as never[], 3);
  assert.match(html, /<h1>2023 BMW 540i for Sale<\/h1>/);
  assert.match(html, /2023 BMW 540i listings/);
  assert.match(html, /<title>2023 BMW 540i for Sale \| AutoNegotiating<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/540i\/2023"/);
  assert.match(html, /\/vehicle\/1C4HJXDN6LW114178/);
  assert.match(html, /href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/540i"/);
  assert.match(html, /href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/5-series"/);
  assert.match(html, /href="https:\/\/www\.autonegotiating\.com\/cars"/);
  const json = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
  assert.doesNotThrow(() => JSON.parse(json!));
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"@type":"ItemList"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
});

test("SSR pagination uses query canonical and page-bounded ItemList positions", () => {
  const html = renderPhase3bYearPage(candidate, [row("540i", "1C4HJXDN6LW114178")] as never[], 201, 2);
  assert.match(html, /rel="canonical" href="https:\/\/www\.autonegotiating\.com\/cars\/bmw\/540i\/2023\?page=2"/);
  assert.match(html, /href="\/cars\/bmw\/540i\/2023\?page=1"/);
  assert.match(html, /href="\/cars\/bmw\/540i\/2023\?page=3"/);
  assert.match(html, /"position":101/);
});

test("year sitemap includes qualifying URLs exactly once and excludes below-threshold duplicates", () => {
  const urls = phase3bYearSitemapUrls([
    candidate, candidate, { entity: m550i, year: 2023 },
  ]);
  assert.deepEqual(urls, [
    "https://www.autonegotiating.com/cars/bmw/540i/2023",
    "https://www.autonegotiating.com/cars/bmw/m550i/2023",
  ]);
  assert.equal(urls.length, new Set(urls).size);
  assert.deepEqual(modelFamilySitemapUrls([{ make: "BMW", model: "5 Series", count: 1 }]), [
    "https://www.autonegotiating.com/cars/bmw/5-series",
  ]);
});

test("IndexNow activation, material changes, removal, and below-threshold no-op are correct", () => {
  const active = phase3bYearNotificationUrls(new Map([[id(), false]]), new Map([[id(), true]]), [candidate]);
  assert.deepEqual(active, [phase3bYearPath(entity, 2023)].map((path) => `https://www.autonegotiating.com${path}`).concat(phase3aEntityUrl(entity)));
  assert.deepEqual(phase3bYearNotificationUrls(new Map([[id(), true]]), new Map([[id(), true]]), [candidate]), active);
  assert.deepEqual(phase3bYearNotificationUrls(new Map([[id(), true]]), new Map([[id(), false]]), [candidate]), active);
  assert.deepEqual(phase3bYearNotificationUrls(new Map([[id(), false]]), new Map([[id(), false]]), [candidate]), []);
  assert.deepEqual(phase3bYearNotificationUrls(new Map([[id(2022), false]]), new Map([[id(2022), true]]), [candidate]), []);
});

test("Phase 2 and Phase 3A canonical helpers remain independent of year URLs", () => {
  assert.equal(phase3aEntityUrl(entity), "https://www.autonegotiating.com/cars/bmw/540i");
  assert.equal(phase3bYearPath(entity, 2023), "/cars/bmw/540i/2023");
  assert.notEqual(phase3aEntityUrl(entity), `https://www.autonegotiating.com${phase3bYearPath(entity, 2023)}`);
});
import { and, inArray, or, sql } from "drizzle-orm";
import { db, activeInventory, type ActiveInventory } from "@workspace/db";
import { getStaticTrims } from "./static-trims";
import { directorySlug } from "./cars-slugs";
import { INVENTORY_FRESHNESS_DAYS, isValidInventoryVin, qualifiedInventoryWhere } from "./inventory-qualification";

export const PHASE3A_MIN_VEHICLES = 2;
export const PHASE3A_PAGE_SIZE = 100;
export const PHASE3A_ORIGIN = "https://www.autonegotiating.com";
const MIN_VEHICLE_YEAR = 1886;

export type Phase3Entity = {
  make: string;
  name: string;
  slug: string;
  model: string;
  trims: string[];
};

export type Phase3aEntitySummary = {
  totalCount: number;
  years: number[];
  allUsed: boolean;
  allNew: boolean;
};

const BMW_ENTITIES: Phase3Entity[] = [
  { make: "BMW", name: "BMW 530i", slug: "530i", model: "5 Series", trims: ["530i", "530i xDrive"] },
  { make: "BMW", name: "BMW 540i", slug: "540i", model: "5 Series", trims: ["540i", "540i xDrive"] },
  { make: "BMW", name: "BMW M550i", slug: "m550i", model: "5 Series", trims: ["M550i xDrive"] },
  { make: "BMW", name: "BMW M340i", slug: "m340i", model: "3 Series", trims: ["M340i", "M340i xDrive"] },
  { make: "BMW", name: "BMW 840i", slug: "840i", model: "8 Series", trims: ["840i", "840i xDrive", "840i Gran Coupe"] },
  { make: "BMW", name: "BMW M850i", slug: "m850i", model: "8 Series", trims: ["M850i xDrive"] },
];

function key(value: string): string {
  return value.trim().toLowerCase();
}

export function validatePhase3aRegistry(entities: Phase3Entity[] = BMW_ENTITIES): Phase3Entity[] {
  const seen = new Set<string>();
  const seenRaw = new Set<string>();
  return entities.filter((entity) => {
    const slug = directorySlug(entity.slug);
    const staticTrims = getStaticTrims(entity.make, entity.model) ?? [];
    const valid = Boolean(entity.make && entity.name && entity.model && slug) &&
      entity.trims.length > 0 &&
      entity.trims.every((trim) => staticTrims.includes(trim) &&
        !seenRaw.has(`${key(entity.make)}\0${key(entity.model)}\0${key(trim)}`)) &&
      !seen.has(`${key(entity.make)}\0${slug}`);
    if (valid) {
      seen.add(`${key(entity.make)}\0${slug}`);
      entity.trims.forEach((trim) => seenRaw.add(`${key(entity.make)}\0${key(entity.model)}\0${key(trim)}`));
    }
    return valid;
  });
}

export const PHASE3A_ENTITIES = validatePhase3aRegistry();

export function findPhase3aEntity(make: string, slug: string): Phase3Entity | undefined {
  return PHASE3A_ENTITIES.find((entity) =>
    key(entity.make) === key(make) && directorySlug(entity.slug) === directorySlug(slug));
}

export function suppressPhase3aModelCollisions(
  entities: Phase3Entity[],
  modelGroups: Iterable<{ make: string; model: string }>,
): Phase3Entity[] {
  const collisions = new Set([...modelGroups].map((group) =>
    `${key(group.make)}\0${directorySlug(group.model)}`));
  return entities.filter((entity) =>
    !collisions.has(`${key(entity.make)}\0${directorySlug(entity.slug)}`));
}

export function isPhase3aIndexable(vehicleCount: number): boolean {
  return vehicleCount >= PHASE3A_MIN_VEHICLES;
}

export function isPhase3aInventoryQualifying(
  row: Partial<Pick<ActiveInventory, "active" | "vin" | "make" | "model" | "lastSeen">>,
  now = Date.now(),
): boolean {
  return row.active === true &&
    typeof row.vin === "string" && isValidInventoryVin(row.vin) &&
    Boolean(row.make?.trim() && row.model?.trim()) &&
    row.lastSeen instanceof Date &&
    row.lastSeen.getTime() >= now - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
}

export function phase3aEntityForInventory(
  row: Partial<Pick<ActiveInventory, "make" | "model" | "trim">>,
): Phase3Entity | undefined {
  if (!row.make || !row.model || !row.trim) return undefined;
  return PHASE3A_ENTITIES.find((entity) =>
    key(entity.make) === key(row.make!) &&
    key(entity.model) === key(row.model!) &&
    entity.trims.some((trim) => key(trim) === key(row.trim!)));
}

export function phase3aEntityUrl(entity: Phase3Entity): string {
  return `${PHASE3A_ORIGIN}${phase3aCanonicalPath(entity)}`;
}

export function phase3aCanonicalPath(entity: Phase3Entity): string {
  return `/cars/${directorySlug(entity.make)}/${directorySlug(entity.slug)}`;
}

export type Phase3aEntityPageDecision =
  | { kind: "redirect"; location: string }
  | { kind: "not-found" }
  | { kind: "render"; offset: number };

export function phase3aEntityPageDecision(
  requestedPath: string,
  entity: Phase3Entity,
  totalCount: number,
  page: number,
): Phase3aEntityPageDecision {
  const canonicalPath = phase3aCanonicalPath(entity);
  const offset = (page - 1) * PHASE3A_PAGE_SIZE;
  if (totalCount < PHASE3A_MIN_VEHICLES || offset >= totalCount) {
    return { kind: "not-found" };
  }
  if (requestedPath !== canonicalPath) {
    return { kind: "redirect", location: `${canonicalPath}${page > 1 ? `?page=${page}` : ""}` };
  }
  return { kind: "render", offset };
}

export function phase3aSitemapUrls(
  entities: Phase3Entity[],
  states: Map<string, boolean>,
  modelGroups: Iterable<{ make: string; model: string }> = [],
): string[] {
  return suppressPhase3aModelCollisions(entities, modelGroups)
    .filter((entity) => states.get(`${key(entity.make)}\0${entity.slug}`) === true)
    .map(phase3aEntityUrl);
}

export function phase3aNotificationUrls(
  before: Map<string, boolean>,
  after: Map<string, boolean>,
  candidates: Phase3Entity[],
): string[] {
  return candidates.filter((entity) => {
    const id = `${key(entity.make)}\0${entity.slug}`;
    return before.get(id) === true || after.get(id) === true;
  }).map(phase3aEntityUrl);
}

export function phase3aNotificationPlan(
  before: Map<string, boolean> | undefined,
  after: Map<string, boolean> | undefined,
  candidates: Phase3Entity[],
): string[] {
  return before && after ? phase3aNotificationUrls(before, after, candidates) : [];
}

export function phase3aAffectedEntityUrls(candidates: Phase3Entity[]): string[] {
  return [...new Map(candidates.map((entity) => [entity.slug, phase3aEntityUrl(entity)])).values()];
}

function cutoff(): Date {
  return new Date(Date.now() - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
}

export function phase3aEntityWhere(entity: Phase3Entity, date = cutoff()) {
  return and(
    qualifiedInventoryWhere(date),
    sql`lower(trim(${activeInventory.make})) = ${key(entity.make)}`,
    sql`lower(trim(${activeInventory.model})) = ${key(entity.model)}`,
    inArray(sql`lower(trim(${activeInventory.trim}))`, entity.trims.map(key)),
  );
}

export async function qualifiedPhase3aEntityCount(entity: Phase3Entity): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(activeInventory).where(phase3aEntityWhere(entity));
  return Number(result?.count ?? 0);
}

export async function qualifiedPhase3aEntitySummary(entity: Phase3Entity): Promise<Phase3aEntitySummary> {
  const currentYear = new Date().getUTCFullYear();
  const [result] = await db.select({
    totalCount: sql<number>`count(*)`,
    years: sql<unknown>`coalesce(array_agg(distinct ${activeInventory.year} order by ${activeInventory.year})
      filter (where ${activeInventory.year} between ${MIN_VEHICLE_YEAR} and ${currentYear + 2}), '{}')`,
    usedCount: sql<number>`count(*) filter (where lower(trim(coalesce(${activeInventory.condition}, ''))) = 'used')`,
    newCount: sql<number>`count(*) filter (where lower(trim(coalesce(${activeInventory.condition}, ''))) = 'new')`,
  }).from(activeInventory).where(phase3aEntityWhere(entity));
  const years = Array.isArray(result?.years)
    ? result.years.map(Number).filter((year) => Number.isInteger(year))
    : [];
  const totalCount = Number(result?.totalCount ?? 0);
  return {
    totalCount,
    years,
    allUsed: totalCount > 0 && Number(result?.usedCount ?? 0) === totalCount,
    allNew: totalCount > 0 && Number(result?.newCount ?? 0) === totalCount,
  };
}

export async function qualifiedPhase3aEntityRows(
  entity: Phase3Entity,
  offset = 0,
  limit = PHASE3A_PAGE_SIZE,
): Promise<ActiveInventory[]> {
  return db.select().from(activeInventory).where(phase3aEntityWhere(entity))
    .orderBy(activeInventory.vin).limit(Math.min(PHASE3A_PAGE_SIZE, Math.max(0, limit)))
    .offset(Math.max(0, offset));
}

export async function qualifiedPhase3aStaleEntityMappings(cutoffDate: Date): Promise<Phase3Entity[]> {
  const mappings = PHASE3A_ENTITIES.flatMap((entity) => entity.trims.map((trim) => ({
    make: key(entity.make), model: key(entity.model), trim: key(trim),
  })));
  const normalizedMake = sql<string>`lower(trim(${activeInventory.make}))`;
  const normalizedModel = sql<string>`lower(trim(${activeInventory.model}))`;
  const normalizedTrim = sql<string>`lower(trim(${activeInventory.trim}))`;
  const rows = await db.select({
    make: normalizedMake, model: normalizedModel, trim: normalizedTrim,
  }).from(activeInventory).where(and(
    sql`${activeInventory.active} = true`,
    sql`${activeInventory.lastSeen} < ${cutoffDate}`,
    or(...mappings.map((mapping) => and(
      sql`${normalizedMake} = ${mapping.make}`,
      sql`${normalizedModel} = ${mapping.model}`,
      sql`${normalizedTrim} = ${mapping.trim}`,
    ))),
  )).groupBy(normalizedMake, normalizedModel, normalizedTrim);
  return [...new Map(rows.flatMap((row) => {
    const entity = phase3aEntityForInventory(row);
    return entity ? [[entity.slug, entity] as const] : [];
  })).values()];
}

export async function qualifiedPhase3aEntityStates(): Promise<Map<string, boolean>> {
  const mappings = PHASE3A_ENTITIES.flatMap((entity) => entity.trims.map((trim) => ({
    make: key(entity.make), model: key(entity.model), trim: key(trim),
  })));
  const normalizedMake = sql<string>`lower(trim(${activeInventory.make}))`;
  const normalizedModel = sql<string>`lower(trim(${activeInventory.model}))`;
  const normalizedTrim = sql<string>`lower(trim(${activeInventory.trim}))`;
  const rows = await db.select({
    make: normalizedMake,
    model: normalizedModel,
    trim: normalizedTrim,
    count: sql<number>`count(*)`,
  }).from(activeInventory).where(and(
    qualifiedInventoryWhere(cutoff()),
    or(...mappings.map((mapping) => and(
      sql`lower(trim(${activeInventory.make})) = ${mapping.make}`,
      sql`lower(trim(${activeInventory.model})) = ${mapping.model}`,
      sql`lower(trim(${activeInventory.trim})) = ${mapping.trim}`,
    ))),
  )).groupBy(normalizedMake, normalizedModel, normalizedTrim);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const entity = phase3aEntityForInventory(row);
    if (!entity) continue;
    const id = `${key(entity.make)}\0${entity.slug}`;
    counts.set(id, (counts.get(id) ?? 0) + Number(row.count));
  }
  return new Map(PHASE3A_ENTITIES.map((entity) => {
    const id = `${key(entity.make)}\0${entity.slug}`;
    return [id, isPhase3aIndexable(counts.get(id) ?? 0)];
  }));
}

export async function qualifyingPhase3aEntities(
  modelGroups: Iterable<{ make: string; model: string }> = [],
): Promise<Phase3Entity[]> {
  const states = await qualifiedPhase3aEntityStates();
  return suppressPhase3aModelCollisions(
    PHASE3A_ENTITIES.filter((entity) =>
      states.get(`${key(entity.make)}\0${entity.slug}`) === true),
    modelGroups,
  );
}

export function phase3aDescription(
  entity: Phase3Entity,
  rows: ActiveInventory[],
  totalCount = rows.length,
  availableYears?: number[],
): string {
  const years = availableYears ?? [...new Set(rows.map((row) => row.year).filter((year): year is number => year != null))].sort();
  const yearText = years.length ? ` across model years ${years.join(", ")}` : "";
  return `Browse ${totalCount} current ${entity.name} listings indexed by AutoNegotiating${yearText}, including prices, mileage and dealer locations.`;
}

function html(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderPhase3aPage(
  entity: Phase3Entity,
  rows: ActiveInventory[],
  totalCount = rows.length,
  page = 1,
  summary?: Phase3aEntitySummary,
  yearLinks = "",
): string {
  const path = phase3aCanonicalPath(entity);
  const canonical = `${PHASE3A_ORIGIN}${path}${page > 1 ? `?page=${page}` : ""}`;
  const effectiveSummary = summary ?? {
    totalCount,
    years: [...new Set(rows.map((row) => row.year).filter((year): year is number => year != null))].sort(),
    allUsed: rows.length > 0 && rows.every((row) => row.condition?.toLowerCase() === "used"),
    allNew: rows.length > 0 && rows.every((row) => row.condition?.toLowerCase() === "new"),
  };
  const description = phase3aDescription(entity, rows, effectiveSummary.totalCount, effectiveSummary.years);
  const years = effectiveSummary.years;
  const vehicleItems = rows.map((row, index) => {
    const vehicleUrl = `${PHASE3A_ORIGIN}/vehicle/${encodeURIComponent(row.vin)}`;
    const details = [
      row.year,
      row.trim,
      row.price == null ? undefined : `$${row.price.toLocaleString()}`,
      row.mileage == null ? undefined : `${row.mileage.toLocaleString()} miles`,
      [row.dealerCity, row.dealerState].filter(Boolean).join(", ") || undefined,
    ].filter(Boolean).map(html).join(" · ");
    return `<li><article><h2><a href="${html(vehicleUrl)}">${html(`${row.year ?? ""} ${entity.name}`)}</a></h2><p>${details}</p>` +
      `${row.dealerName ? `<p>${html(row.dealerName)}</p>` : ""}</article></li>`;
  }).join("");
  const itemList = rows.map((row, index) => ({
    "@type": "ListItem", position: (page - 1) * PHASE3A_PAGE_SIZE + index + 1,
    url: `${PHASE3A_ORIGIN}/vehicle/${encodeURIComponent(row.vin)}`,
    name: [row.year, row.make, row.model, row.trim].filter(Boolean).join(" "),
  }));
  const jsonLd = { "@context": "https://schema.org", "@graph": [
    { "@id": `${canonical}#page`, "@type": "CollectionPage", name: `${entity.name} for Sale`, url: canonical, description, mainEntity: { "@id": `${canonical}#inventory` } },
    { "@id": `${canonical}#inventory`, "@type": "ItemList", itemListElement: itemList },
    { "@id": `${canonical}#breadcrumbs`, "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Cars", item: `${PHASE3A_ORIGIN}/cars` },
      { "@type": "ListItem", position: 2, name: `${entity.make} ${entity.model}`, item: `${PHASE3A_ORIGIN}/cars/${directorySlug(entity.make)}/${directorySlug(entity.model)}` },
      { "@type": "ListItem", position: 3, name: entity.name, item: canonical },
    ] },
  ] };
  const jsonLdText = JSON.stringify(jsonLd).replace(/[<>&\u2028\u2029]/g, (character) => ({
    "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029",
  }[character] ?? character));
  const conditionPrefix = effectiveSummary.allUsed ? "Used " : effectiveSummary.allNew ? "New " : "";
  const title = `${conditionPrefix}${entity.name} for Sale${page > 1 ? ` — Page ${page}` : ""} | AutoNegotiating`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${html(title)}</title><meta name="description" content="${html(description)}">` +
    `<meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}">` +
    `<meta property="og:url" content="${html(canonical)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary">` +
    `<link rel="canonical" href="${html(canonical)}"><script type="application/ld+json">${jsonLdText}</script>` +
    `<style>body{font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a18;background:#fafaf7;margin:0}header{background:#fff;border-bottom:1px solid #e8e8e2;padding:18px 24px}header a{color:#1a1a18;text-decoration:none;font-weight:700;font-size:22px}main{max-width:1000px;margin:auto;padding:32px 24px 60px}h1,h2{font-family:Georgia,serif}h1{font-size:40px}section{background:#fff;border:1px solid #e8e8e2;border-radius:10px;padding:16px 20px;margin:16px 0}a{color:#a34a12}li{margin:14px 0}</style></head><body><header><a href="${PHASE3A_ORIGIN}/">AutoNegotiating.com</a></header><main>` +
    `<nav><a href="${PHASE3A_ORIGIN}/cars">Cars</a> · <a href="${html(`${PHASE3A_ORIGIN}/cars/${directorySlug(entity.make)}/${directorySlug(entity.model)}`)}">${html(`${entity.make} ${entity.model}`)}</a></nav>` +
      `<h1>${html(`${entity.name} for Sale`)}</h1><p>${html(description)}</p><p>${totalCount} qualifying vehicles${years.length ? ` · Model years: ${years.join(", ")}` : ""}</p>${yearLinks ? `<section><h2>Available model years</h2><ul>${yearLinks}</ul></section>` : ""}<section><h2>Current ${html(entity.name)} listings</h2><ul>${vehicleItems}</ul></section>` +
     `<nav aria-label="Pagination">${page > 1 ? `<a href="${html(`${path}?page=${page - 1}`)}">Previous</a>` : ""}${page > 1 && page * PHASE3A_PAGE_SIZE < totalCount ? " · " : ""}${page * PHASE3A_PAGE_SIZE < totalCount ? `<a href="${html(`${path}?page=${page + 1}`)}">Next</a>` : ""}</nav>` +
    `</main></body></html>`;
}
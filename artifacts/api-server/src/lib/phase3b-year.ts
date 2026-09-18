import { and, eq, or, sql } from "drizzle-orm";
import { db, activeInventory, type ActiveInventory } from "@workspace/db";
import { directorySlug } from "./cars-slugs";
import {
  PHASE3A_ENTITIES,
  PHASE3A_ORIGIN,
  PHASE3A_PAGE_SIZE,
  type Phase3Entity,
  phase3aCanonicalPath,
  phase3aEntityForInventory,
  phase3aEntityUrl,
  phase3aEntityWhere,
} from "./phase3a";
import { INVENTORY_FRESHNESS_DAYS, qualifiedInventoryWhere } from "./inventory-qualification";

export const PHASE3B_YEAR_MIN_VEHICLES = 3;
export const PHASE3B_STAT_MIN_OBSERVATIONS = 3;
export const PHASE3B_MIN_YEAR = 1886;
export const PHASE3B_YEAR_PAGE_SIZE = PHASE3A_PAGE_SIZE;

export type Phase3bYearEntity = { entity: Phase3Entity; year: number };
export type Phase3bYearSummary = {
  totalCount: number;
  priceCount: number;
  minPrice?: number;
  medianPrice?: number;
  maxPrice?: number;
  mileageCount: number;
  minMileage?: number;
  medianMileage?: number;
  maxMileage?: number;
};

function key(value: string): string { return value.trim().toLowerCase(); }
function id(candidate: Phase3bYearEntity): string {
  return `${key(candidate.entity.make)}\0${candidate.entity.slug}\0${candidate.year}`;
}
function cutoff(): Date {
  return new Date(Date.now() - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
}

export function phase3bYearPath(entity: Phase3Entity, year: number): string {
  return `${phase3aCanonicalPath(entity)}/${year}`;
}
export function phase3bYearUrl(entity: Phase3Entity, year: number): string {
  return `${PHASE3A_ORIGIN}${phase3bYearPath(entity, year)}`;
}
export function isSupportedPhase3bYear(value: unknown, now = new Date()): value is number {
  if (typeof value !== "string" || !/^[0-9]{4}$/.test(value)) return false;
  const year = Number(value);
  return isSupportedPhase3bYearNumber(year, now);
}
export function isSupportedPhase3bYearNumber(value: unknown, now = new Date()): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= PHASE3B_MIN_YEAR && value <= now.getUTCFullYear() + 2;
}
export function phase3bYearEntity(
  make: string,
  slug: string,
  year: unknown,
): Phase3bYearEntity | undefined {
  if (!isSupportedPhase3bYear(year)) return undefined;
  const entity = PHASE3A_ENTITIES.find((candidate) =>
    key(candidate.make) === key(make) && directorySlug(candidate.slug) === directorySlug(slug));
  return entity ? { entity, year: Number(year) } : undefined;
}
export type Phase3bYearPageDecision =
  | { kind: "redirect"; location: string }
  | { kind: "not-found" }
  | { kind: "render"; offset: number };
export function phase3bYearPageDecision(
  requestedPath: string,
  candidate: Phase3bYearEntity,
  totalCount: number,
  page: number,
): Phase3bYearPageDecision {
  const canonicalPath = phase3bYearPath(candidate.entity, candidate.year);
  const offset = (page - 1) * PHASE3B_YEAR_PAGE_SIZE;
  if (totalCount < PHASE3B_YEAR_MIN_VEHICLES || offset >= totalCount) return { kind: "not-found" };
  if (requestedPath !== canonicalPath) {
    return { kind: "redirect", location: `${canonicalPath}${page > 1 ? `?page=${page}` : ""}` };
  }
  return { kind: "render", offset };
}

function yearWhere(candidate: Phase3bYearEntity, date = cutoff()) {
  return and(phase3aEntityWhere(candidate.entity, date), eq(activeInventory.year, candidate.year));
}
export async function qualifiedPhase3bYearCount(candidate: Phase3bYearEntity): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(activeInventory)
    .where(yearWhere(candidate));
  return Number(result?.count ?? 0);
}
export async function qualifiedPhase3bYearRows(
  candidate: Phase3bYearEntity, offset = 0, limit = PHASE3B_YEAR_PAGE_SIZE,
): Promise<ActiveInventory[]> {
  return db.select().from(activeInventory).where(yearWhere(candidate))
    .orderBy(activeInventory.vin).limit(Math.min(PHASE3B_YEAR_PAGE_SIZE, Math.max(0, limit)))
    .offset(Math.max(0, offset));
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function phase3bYearSummary(rows: ActiveInventory[]): Phase3bYearSummary {
  const prices = rows.map((row) => row.price).filter((value): value is number => value != null && value > 0);
  const mileage = rows.map((row) => row.mileage).filter((value): value is number => value != null && value >= 0);
  return {
    totalCount: rows.length,
    priceCount: prices.length,
    ...(prices.length >= PHASE3B_STAT_MIN_OBSERVATIONS
      ? { minPrice: Math.min(...prices), medianPrice: median(prices), maxPrice: Math.max(...prices) } : {}),
    mileageCount: mileage.length,
    ...(mileage.length >= PHASE3B_STAT_MIN_OBSERVATIONS
      ? { minMileage: Math.min(...mileage), medianMileage: median(mileage), maxMileage: Math.max(...mileage) } : {}),
  };
}
export async function qualifiedPhase3bYearSummary(candidate: Phase3bYearEntity): Promise<Phase3bYearSummary> {
  const rows = await db.select().from(activeInventory).where(yearWhere(candidate)).orderBy(activeInventory.vin);
  return phase3bYearSummary(rows);
}

export async function qualifiedPhase3bYearStates(): Promise<Map<string, boolean>> {
  const mappings = PHASE3A_ENTITIES.flatMap((entity) => entity.trims.map((trim) => ({
    make: key(entity.make), model: key(entity.model), trim: key(trim),
  })));
  const normalizedMake = sql<string>`lower(trim(${activeInventory.make}))`;
  const normalizedModel = sql<string>`lower(trim(${activeInventory.model}))`;
  const normalizedTrim = sql<string>`lower(trim(${activeInventory.trim}))`;
  const rows = await db.select({
    make: normalizedMake, model: normalizedModel, trim: normalizedTrim,
    year: activeInventory.year, count: sql<number>`count(*)`,
  }).from(activeInventory).where(and(
    qualifiedInventoryWhere(cutoff()),
    sql`${activeInventory.year} between ${PHASE3B_MIN_YEAR} and ${new Date().getUTCFullYear() + 2}`,
    or(...mappings.map((mapping) => and(
      sql`${normalizedMake} = ${mapping.make}`,
      sql`${normalizedModel} = ${mapping.model}`,
      sql`${normalizedTrim} = ${mapping.trim}`,
    ))),
  )).groupBy(activeInventory.make, activeInventory.model, activeInventory.trim, activeInventory.year);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const entity = phase3aEntityForInventory(row);
    if (!entity || row.year == null) continue;
    if (!isSupportedPhase3bYearNumber(Number(row.year))) continue;
    const candidate = { entity, year: Number(row.year) };
    counts.set(id(candidate), (counts.get(id(candidate)) ?? 0) + Number(row.count));
  }
  const states = new Map<string, boolean>();
  for (const [candidateId, count] of counts) states.set(candidateId, count >= PHASE3B_YEAR_MIN_VEHICLES);
  return states;
}
export async function qualifyingPhase3bYearEntities(): Promise<Phase3bYearEntity[]> {
  const states = await qualifiedPhase3bYearStates();
  const output: Phase3bYearEntity[] = [];
  for (const [candidateId, qualified] of states) {
    if (!qualified) continue;
    const [make, slug, year] = candidateId.split("\0");
    const entity = PHASE3A_ENTITIES.find((candidate) =>
      key(candidate.make) === make && candidate.slug === slug);
    if (entity) output.push({ entity, year: Number(year) });
  }
  return output.sort((a, b) => a.entity.slug.localeCompare(b.entity.slug) || a.year - b.year);
}
export async function qualifiedPhase3bYearEntitiesForNational(entity: Phase3Entity): Promise<Phase3bYearEntity[]> {
  return (await qualifyingPhase3bYearEntities()).filter((candidate) => candidate.entity.slug === entity.slug &&
    key(candidate.entity.make) === key(entity.make));
}
export function phase3bYearSitemapUrls(candidates: Phase3bYearEntity[]): string[] {
  return [...new Set(candidates.filter((candidate) => isSupportedPhase3bYearNumber(candidate.year))
    .map((candidate) => phase3bYearUrl(candidate.entity, candidate.year)))];
}
export function phase3bYearNotificationUrls(
  before: Map<string, boolean>,
  after: Map<string, boolean>,
  candidates: Phase3bYearEntity[],
): string[] {
  return [...new Set(candidates.filter((candidate) => isSupportedPhase3bYearNumber(candidate.year) &&
    (before.get(id(candidate)) === true || after.get(id(candidate)) === true))
    .flatMap((candidate) => [
      phase3bYearUrl(candidate.entity, candidate.year),
      phase3aEntityUrl(candidate.entity),
    ]))];
}
export function phase3bYearCandidatesForRows(rows: Array<Partial<ActiveInventory>>): Phase3bYearEntity[] {
  return [...new Map(rows.flatMap((row) => {
    const entity = phase3aEntityForInventory(row);
    return entity && isSupportedPhase3bYearNumber(row.year)
      ? [[id({ entity, year: row.year }), { entity, year: row.year }]] : [];
  })).values()];
}
export function phase3bYearCandidatesBeforeStaleDeactivation(
  rows: Array<Partial<ActiveInventory>>, cutoffDate: Date,
): Phase3bYearEntity[] {
  const groups = new Map<string, { candidate: Phase3bYearEntity; total: number; stale: number }>();
  for (const row of rows) {
    const entity = phase3aEntityForInventory(row);
    if (row.active !== true || !entity || !isSupportedPhase3bYearNumber(row.year)) continue;
    const candidate = { entity, year: row.year };
    const candidateId = id(candidate);
    const group = groups.get(candidateId) ?? { candidate, total: 0, stale: 0 };
    group.total += 1;
    if (row.active === true && row.lastSeen instanceof Date && row.lastSeen < cutoffDate) group.stale += 1;
    groups.set(candidateId, group);
  }
  return [...groups.values()].filter((group) => group.total >= PHASE3B_YEAR_MIN_VEHICLES && group.stale > 0)
    .map((group) => group.candidate);
}
export async function qualifiedPhase3bStaleYearMappings(cutoffDate: Date): Promise<Phase3bYearEntity[]> {
  const mappings = PHASE3A_ENTITIES.flatMap((entity) => entity.trims.map((trim) => ({
    make: key(entity.make), model: key(entity.model), trim: key(trim),
  })));
  const normalizedMake = sql<string>`lower(trim(${activeInventory.make}))`;
  const normalizedModel = sql<string>`lower(trim(${activeInventory.model}))`;
  const normalizedTrim = sql<string>`lower(trim(${activeInventory.trim}))`;
  const rows = await db.select({ make: activeInventory.make, model: activeInventory.model, trim: activeInventory.trim, year: activeInventory.year, active: activeInventory.active, lastSeen: activeInventory.lastSeen })
    .from(activeInventory).where(and(
      sql`${activeInventory.active} = true`,
      sql`${activeInventory.vin} ~* '^[A-HJ-NPR-Z0-9]{17}$'`,
      or(...mappings.map((mapping) => and(
        sql`${normalizedMake} = ${mapping.make}`,
        sql`${normalizedModel} = ${mapping.model}`,
        sql`${normalizedTrim} = ${mapping.trim}`,
      ))),
    ));
  return phase3bYearCandidatesBeforeStaleDeactivation(rows, cutoffDate);
}

function html(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function renderPhase3bYearPage(
  candidate: Phase3bYearEntity, rows: ActiveInventory[], totalCount: number, page = 1,
  summary = phase3bYearSummary(rows),
): string {
  const { entity, year } = candidate;
  const path = phase3bYearPath(entity, year);
  const canonical = `${PHASE3A_ORIGIN}${path}${page > 1 ? `?page=${page}` : ""}`;
  const pageSuffix = page > 1 ? ` — Page ${page}` : "";
  const description = `Browse ${totalCount} current ${year} ${entity.name} listings with prices, mileage and dealer locations.${page > 1 ? ` Page ${page}.` : ""}`;
  const vehicles = rows.map((row) => `<li><article><h2><a href="${html(`${PHASE3A_ORIGIN}/vehicle/${encodeURIComponent(row.vin)}`)}">${html(`${year} ${entity.name}`)}</a></h2>` +
    `<p>${html([row.trim, row.price != null && row.price > 0 ? `$${row.price.toLocaleString()}` : undefined, row.mileage != null && row.mileage >= 0 ? `${row.mileage.toLocaleString()} miles` : undefined, [row.dealerCity, row.dealerState].filter(Boolean).join(", ") || undefined].filter(Boolean).join(" · "))}</p>` +
    `${row.dealerName ? `<p>${html(row.dealerName)}</p>` : ""}</article></li>`).join("");
  const itemList = rows.map((row, index) => ({ "@type": "ListItem", position: (page - 1) * PHASE3B_YEAR_PAGE_SIZE + index + 1, url: `${PHASE3A_ORIGIN}/vehicle/${encodeURIComponent(row.vin)}`, name: [row.year, row.make, row.model, row.trim].filter(Boolean).join(" ") }));
  const jsonLd = { "@context": "https://schema.org", "@graph": [
    { "@id": `${canonical}#page`, "@type": "CollectionPage", name: `${year} ${entity.name} for Sale${pageSuffix}`, url: canonical, description, mainEntity: { "@id": `${canonical}#inventory` } },
    { "@id": `${canonical}#inventory`, "@type": "ItemList", numberOfItems: rows.length, itemListElement: itemList },
    { "@id": `${canonical}#breadcrumbs`, "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Cars", item: `${PHASE3A_ORIGIN}/cars` },
      { "@type": "ListItem", position: 2, name: `${entity.make} ${entity.model}`, item: `${PHASE3A_ORIGIN}/cars/${directorySlug(entity.make)}/${directorySlug(entity.model)}` },
      { "@type": "ListItem", position: 3, name: entity.name, item: phase3aEntityUrl(entity) },
      { "@type": "ListItem", position: 4, name: `${year} ${entity.name}`, item: canonical },
    ] },
  ] };
  const jsonLdText = JSON.stringify(jsonLd).replace(/[<>&\u2028\u2029]/g, (character) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" }[character] ?? character));
  const stats = [
    summary.minPrice != null ? `Asking price range: $${summary.minPrice.toLocaleString()}–$${summary.maxPrice!.toLocaleString()} (${summary.priceCount} valid observations)` : "",
    summary.medianPrice != null ? `Median asking price: $${summary.medianPrice.toLocaleString()} (${summary.priceCount} valid observations)` : "",
    summary.minMileage != null ? `Mileage range: ${summary.minMileage.toLocaleString()}–${summary.maxMileage!.toLocaleString()} miles (${summary.mileageCount} valid observations)` : "",
    summary.medianMileage != null ? `Median mileage: ${summary.medianMileage.toLocaleString()} miles (${summary.mileageCount} valid observations)` : "",
  ].filter(Boolean).map((text) => `<li>${html(text)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${html(`${year} ${entity.name} for Sale${pageSuffix} | AutoNegotiating`)}</title><meta name="description" content="${html(description)}"><link rel="canonical" href="${html(canonical)}"><script type="application/ld+json">${jsonLdText}</script></head><body><main>` +
    `<nav><a href="${PHASE3A_ORIGIN}/cars">Cars</a> · <a href="${html(phase3aEntityUrl(entity))}">${html(entity.name)}</a> · <a href="${html(`${PHASE3A_ORIGIN}/cars/${directorySlug(entity.make)}/${directorySlug(entity.model)}`)}">${html(`${entity.make} ${entity.model}`)}</a></nav>` +
    `<h1>${html(`${year} ${entity.name} for Sale`)}</h1><p>${html(description)}</p><p>${totalCount} qualifying vehicles</p>${stats ? `<section><h2>Inventory summary</h2><ul>${stats}</ul></section>` : ""}<section><h2>Current listings</h2><ul>${vehicles}</ul></section>` +
    `<nav aria-label="Pagination">${page > 1 ? `<a href="${html(`${path}?page=${page - 1}`)}">Previous</a>` : ""}${page > 1 && page * PHASE3B_YEAR_PAGE_SIZE < totalCount ? " · " : ""}${page * PHASE3B_YEAR_PAGE_SIZE < totalCount ? `<a href="${html(`${path}?page=${page + 1}`)}">Next</a>` : ""}</nav></main></body></html>`;
}
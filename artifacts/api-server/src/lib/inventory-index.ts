import { and, eq, lt, gte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, activeInventory, type InsertActiveInventory, type ActiveInventory } from "@workspace/db";
import { logger } from "./logger";

const DEFAULT_FRESHNESS_DAYS = 30;
const MIN_FRESHNESS_DAYS = 1;
const MAX_FRESHNESS_DAYS = 365;
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const STALE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export const INVENTORY_FRESHNESS_DAYS = readFreshnessDays();
let lastStaleRefresh = 0;

function readFreshnessDays(): number {
  const parsed = Number(process.env.INVENTORY_FRESHNESS_DAYS);
  if (!Number.isFinite(parsed)) return DEFAULT_FRESHNESS_DAYS;
  return Math.min(MAX_FRESHNESS_DAYS, Math.max(MIN_FRESHNESS_DAYS, Math.floor(parsed)));
}

export function isValidInventoryVin(value: unknown): value is string {
  return typeof value === "string" && VIN_PATTERN.test(value.trim());
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function textValue(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function absoluteUrl(value: unknown): string | null {
  const candidate = textValue(value);
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return candidate.startsWith("/") ? `https://www.auto.dev${candidate}` : null;
}

function valueFrom(listing: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (listing[key] != null) return listing[key];
  return undefined;
}

export function normalizeInventoryListing(listing: Record<string, unknown>): InsertActiveInventory | null {
  const nestedVehicle = (listing.vehicle && typeof listing.vehicle === "object"
    ? listing.vehicle : {}) as Record<string, unknown>;
  const nestedRetail = (listing.retailListing && typeof listing.retailListing === "object"
    ? listing.retailListing : {}) as Record<string, unknown>;
  const vinValue = valueFrom(listing, ["vin", "VIN"]) ?? nestedVehicle.vin;
  const vin = typeof vinValue === "string" ? vinValue.trim().toUpperCase() : "";
  if (!isValidInventoryVin(vin)) return null;

  const year = numberValue(valueFrom(listing, ["year"]) ?? nestedVehicle.year);
  const make = textValue(valueFrom(listing, ["make"]) ?? nestedVehicle.make);
  const model = textValue(valueFrom(listing, ["model"]) ?? nestedVehicle.model);
  if (!make || !model) return null;

  const price = numberValue(valueFrom(listing, ["priceUnformatted", "price"]) ?? nestedRetail.price);
  const mileage = numberValue(
    valueFrom(listing, ["mileageUnformatted", "mileage", "miles"]) ?? nestedRetail.miles,
  );
  const sourceUrl = absoluteUrl(valueFrom(listing, [
    "sourceUrl", "clickoffUrl", "dealerListingUrl", "dealerUrl", "listingUrl", "vdpUrl",
  ]) ?? nestedRetail.vdp);
  const now = new Date();
  return {
    vin,
    year,
    make,
    model,
    trim: textValue(valueFrom(listing, ["trim"]) ?? nestedVehicle.trim),
    condition: textValue(valueFrom(listing, ["condition"]) ??
      (nestedRetail.used === true ? "used" : nestedRetail.used === false ? "new" : undefined)),
    price,
    mileage,
    dealerName: textValue(valueFrom(listing, ["dealerName", "dealer"]) ?? nestedRetail.dealer),
    dealerCity: textValue(valueFrom(listing, ["city", "dealerCity"]) ?? nestedRetail.city),
    dealerState: textValue(valueFrom(listing, ["state", "dealerState"]) ?? nestedRetail.state),
    sourceUrl,
    firstSeen: now,
    lastSeen: now,
    updatedAt: now,
    active: true,
  };
}

export function indexInventoryListings(listings: Array<Record<string, unknown>>): void {
  const records = listings.map(normalizeInventoryListing).filter(
    (record): record is InsertActiveInventory => Boolean(record),
  );
  if (!records.length) return;

  // De-duplicate a response before the single batch insert.
  const unique = [...new Map(records.map((record) => [record.vin, record])).values()];
  db.insert(activeInventory)
    .values(unique)
    .onConflictDoUpdate({
      target: activeInventory.vin,
      set: {
        year: sql`excluded.year`,
        make: sql`excluded.make`,
        model: sql`excluded.model`,
        trim: sql`excluded.trim`,
        condition: sql`excluded.condition`,
        price: sql`excluded.price`,
        mileage: sql`excluded.mileage`,
        dealerName: sql`excluded.dealer_name`,
        dealerCity: sql`excluded.dealer_city`,
        dealerState: sql`excluded.dealer_state`,
        sourceUrl: sql`excluded.source_url`,
        lastSeen: sql`excluded.last_seen`,
        updatedAt: sql`excluded.updated_at`,
        active: sql`true`,
      },
    })
    .catch((err) => logger.warn({ err }, "active inventory upsert failed"));
}

export async function refreshStaleInventory(): Promise<void> {
  const now = Date.now();
  if (now - lastStaleRefresh < STALE_REFRESH_INTERVAL_MS) return;
  lastStaleRefresh = now;
  const cutoff = new Date(now - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
  try {
    await db.update(activeInventory)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(activeInventory.active, true), lt(activeInventory.lastSeen, cutoff)));
  } catch (err) {
    logger.warn({ err }, "active inventory stale refresh failed");
  }
}

function qualifiedPredicate(cutoff: Date): SQL {
  return and(
    eq(activeInventory.active, true),
    gte(activeInventory.lastSeen, cutoff),
    sql`${activeInventory.vin} ~* '^[A-HJ-NPR-Z0-9]{17}$'`,
    sql`length(trim(${activeInventory.make})) > 0`,
    sql`length(trim(${activeInventory.model})) > 0`,
  )!;
}

async function qualifiedCutoff(): Promise<Date> {
  await refreshStaleInventory();
  return new Date(Date.now() - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
}

export async function qualifiedInventoryCount(): Promise<number> {
  const cutoff = await qualifiedCutoff();
  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(activeInventory)
    .where(qualifiedPredicate(cutoff));
  return Number(result?.count || 0);
}

export async function qualifiedVehicleShard(offset: number, limit: number): Promise<
  Pick<ActiveInventory, "vin" | "updatedAt">[]
> {
  const cutoff = await qualifiedCutoff();
  return db.select({ vin: activeInventory.vin, updatedAt: activeInventory.updatedAt })
    .from(activeInventory)
    .where(qualifiedPredicate(cutoff))
    .orderBy(activeInventory.vin)
    .limit(limit)
    .offset(offset);
}

export async function qualifiedInventoryGroups(): Promise<Array<{ make: string; model: string; count: number }>> {
  const cutoff = await qualifiedCutoff();
  const rows = await db.select({
    make: activeInventory.make,
    model: activeInventory.model,
    count: sql<number>`count(*)`,
  }).from(activeInventory)
    .where(qualifiedPredicate(cutoff))
    .groupBy(activeInventory.make, activeInventory.model)
    .orderBy(activeInventory.make, activeInventory.model);
  return rows.map((row) => ({
    make: row.make!.trim(),
    model: row.model!.trim(),
    count: Number(row.count),
  }));
}

export async function qualifiedInventoryPage(
  make: string,
  model: string,
  offset: number,
  limit: number,
): Promise<Pick<ActiveInventory, "vin" | "year" | "make" | "model" | "trim" | "dealerName">[]> {
  const cutoff = await qualifiedCutoff();
  return db.select({
    vin: activeInventory.vin,
    year: activeInventory.year,
    make: activeInventory.make,
    model: activeInventory.model,
    trim: activeInventory.trim,
    dealerName: activeInventory.dealerName,
  }).from(activeInventory)
    .where(and(qualifiedPredicate(cutoff), eq(activeInventory.make, make), eq(activeInventory.model, model)))
    .orderBy(activeInventory.vin)
    .limit(limit)
    .offset(offset);
}
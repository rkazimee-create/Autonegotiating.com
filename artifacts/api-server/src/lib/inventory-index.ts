import { and, eq, lt, sql, inArray } from "drizzle-orm";
import { db, activeInventory, type InsertActiveInventory, type ActiveInventory } from "@workspace/db";
import { logger } from "./logger";
import { queueIndexNow, INDEXNOW_ORIGIN } from "./indexnow";
import { sluggedInventoryGroups } from "./cars-slugs";
import {
  phase3aEntityForInventory,
  phase3aAffectedEntityUrls,
  qualifiedPhase3aStaleEntityMappings,
  qualifiedPhase3aEntityStates,
  phase3aNotificationPlan,
  phase3aEntityUrl,
} from "./phase3a";
import {
  phase3bYearCandidatesForRows,
  phase3bYearNotificationUrls,
  phase3bYearUrl,
  qualifiedPhase3bStaleYearMappings,
  qualifiedPhase3bYearStates,
} from "./phase3b-year";
import {
  INVENTORY_FRESHNESS_DAYS,
  isValidInventoryVin,
  qualifiedInventoryWhere,
} from "./inventory-qualification";
const STALE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
let lastStaleRefresh = 0;

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

const MATERIAL_FIELDS = ["year", "make", "model", "trim", "condition", "price", "mileage",
  "dealerName", "dealerCity", "dealerState", "sourceUrl"] as const;

export type InventoryChangeKind = "new" | "material" | "reactivated";

export function hasMaterialInventoryChange(previous: Partial<ActiveInventory> | undefined,
  next: Partial<InsertActiveInventory>): boolean {
  if (!previous) return true;
  return MATERIAL_FIELDS.some((field) => (previous[field] ?? null) !== (next[field] ?? null));
}

export function inventoryChangeKind(
  previous: Partial<ActiveInventory> | undefined,
  next: Partial<InsertActiveInventory>,
  now = Date.now(),
): InventoryChangeKind | null {
  if (!previous) return "new";
  if (previous.active === false ||
    (previous.lastSeen instanceof Date &&
      previous.lastSeen.getTime() < now - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000)) return "reactivated";
  return hasMaterialInventoryChange(previous, next) ? "material" : null;
}

export function inventoryRowsRequiringNotification(
  rows: InsertActiveInventory[],
  previousByVin: Map<string, Partial<ActiveInventory>>,
): InsertActiveInventory[] {
  return rows.filter((row) => inventoryChangeKind(previousByVin.get(row.vin), row));
}
type InventoryGroupName = { make: string; model: string };

function groupKey(group: InventoryGroupName): string {
  return `${group.make}\0${group.model}`;
}

export function inventoryUrls(
  vins: string[],
  affectedGroups: InventoryGroupName[],
  canonicalGroups: InventoryGroupName[] = affectedGroups,
): string[] {
  const urls = vins.map((vin) => `${INDEXNOW_ORIGIN}/vehicle/${encodeURIComponent(vin)}`);
  const affectedKeys = new Set(affectedGroups.map(groupKey));
  const combined = [...new Map(
    [...canonicalGroups, ...affectedGroups].map((group) => [groupKey(group), group]),
  ).values()];
  const slugged = sluggedInventoryGroups(combined.map((group) => ({ ...group, count: 1 })));
  return urls.concat(slugged
    .filter((group) => affectedKeys.has(groupKey(group)))
    .map((group) => `${INDEXNOW_ORIGIN}/cars/${group.makeSlug}/${group.modelSlug}`));
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
  (async () => {
    let preUpsertGroups: Array<{ make: string; model: string; count: number }> = [];
    try {
      preUpsertGroups = await qualifiedInventoryGroups();
    } catch (err) {
      logger.warn({ err }, "pre-upsert inventory bookkeeping failed");
    }
    const existing = await db.select().from(activeInventory)
      .where(inArray(activeInventory.vin, unique.map((row) => row.vin)));
    const oldByVin = new Map(existing.map((row) => [row.vin, row]));
    let beforePhase3: Map<string, boolean> | undefined;
    let beforePhase3bYears: Map<string, boolean> | undefined;
    try {
      beforePhase3 = await qualifiedPhase3aEntityStates();
    } catch (err) {
      logger.warn({ err }, "pre-upsert Phase 3A bookkeeping failed");
    }
    try {
      beforePhase3bYears = await qualifiedPhase3bYearStates();
    } catch (err) {
      logger.warn({ err }, "pre-upsert Phase 3B year bookkeeping failed");
    }
    await db.insert(activeInventory).values(unique).onConflictDoUpdate({
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
    });
    const changed = inventoryRowsRequiringNotification(unique, oldByVin);
    if (changed.length) {
      let postUpsertGroups: Array<{ make: string; model: string; count: number }> = [];
      try {
        postUpsertGroups = await qualifiedInventoryGroups();
      } catch (err) {
        logger.warn({ err }, "post-upsert inventory bookkeeping failed");
      }
      const oldAffectedGroups = changed.flatMap((row) => {
        const old = oldByVin.get(row.vin);
        return old?.active && old.make && old.model ? [{ make: old.make, model: old.model }] : [];
      });
      const newAffectedGroups = changed
        .filter((row): row is InsertActiveInventory & InventoryGroupName => Boolean(row.make && row.model))
        .map((row) => ({ make: row.make, model: row.model }));
      const oldPhase3Entities = [...new Set(changed.flatMap((row) => {
        const old = oldByVin.get(row.vin);
        const entity = old ? phase3aEntityForInventory(old) : undefined;
        return entity ? [entity] : [];
      }))];
      const newPhase3Entities = [...new Set(changed.flatMap((row) => {
        const entity = phase3aEntityForInventory(row);
        return entity ? [entity] : [];
      }))];
      let afterPhase3: Map<string, boolean> | undefined;
      let afterPhase3bYears: Map<string, boolean> | undefined;
      try {
        afterPhase3 = await qualifiedPhase3aEntityStates();
      } catch (err) {
        logger.warn({ err }, "post-upsert Phase 3A bookkeeping failed");
      }
      try {
        afterPhase3bYears = await qualifiedPhase3bYearStates();
      } catch (err) {
        logger.warn({ err }, "post-upsert Phase 3B year bookkeeping failed");
      }
      const oldPhase3bYears = phase3bYearCandidatesForRows(changed.map((row) => oldByVin.get(row.vin) ?? {}));
      const newPhase3bYears = phase3bYearCandidatesForRows(changed);
      queueIndexNow([
        ...inventoryUrls([], oldAffectedGroups, preUpsertGroups),
        ...inventoryUrls(changed.map((row) => row.vin), newAffectedGroups, postUpsertGroups),
        ...phase3aNotificationPlan(beforePhase3, afterPhase3, [...oldPhase3Entities, ...newPhase3Entities]),
        ...(beforePhase3bYears && afterPhase3bYears
          ? phase3bYearNotificationUrls(beforePhase3bYears, afterPhase3bYears, [...oldPhase3bYears, ...newPhase3bYears])
          : []),
      ]);
    }
  })().catch((err) => logger.warn({ err }, "active inventory upsert failed"));
}

export async function refreshStaleInventory(): Promise<void> {
  const now = Date.now();
  if (now - lastStaleRefresh < STALE_REFRESH_INTERVAL_MS) return;
  lastStaleRefresh = now;
  const cutoff = new Date(now - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
  try {
    let preDeactivationGroups: Array<{ make: string; model: string; count: number }> = [];
    try {
      preDeactivationGroups = await qualifiedInventoryGroups();
    } catch (err) {
      logger.warn({ err }, "pre-deactivation inventory bookkeeping failed");
    }
    let affectedEntities = [] as Awaited<ReturnType<typeof qualifiedPhase3aStaleEntityMappings>>;
    let affectedYearEntities = [] as Awaited<ReturnType<typeof qualifiedPhase3bStaleYearMappings>>;
    try {
      affectedEntities = await qualifiedPhase3aStaleEntityMappings(cutoff);
    } catch (err) {
      logger.warn({ err }, "pre-deactivation Phase 3A bookkeeping failed");
    }
    try {
      affectedYearEntities = await qualifiedPhase3bStaleYearMappings(cutoff);
    } catch (err) {
      logger.warn({ err }, "pre-deactivation Phase 3B year bookkeeping failed");
    }
    const deactivated = await db.update(activeInventory)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(activeInventory.active, true), lt(activeInventory.lastSeen, cutoff)))
      .returning({ vin: activeInventory.vin, make: activeInventory.make, model: activeInventory.model });
    if (deactivated.length) {
      const affectedGroups = deactivated
        .filter((row): row is { vin: string; make: string; model: string } => Boolean(row.make && row.model))
        .map(({ make, model }) => ({ make, model }));
      queueIndexNow(inventoryUrls(
        deactivated.map((row) => row.vin),
        affectedGroups,
        preDeactivationGroups,
      ));
      // A stale row is excluded from the qualified "before" count by design.
      // Always notify its approved entity so a previously indexable page can
      // be removed from the index even when both sampled states are false.
      queueIndexNow(phase3aAffectedEntityUrls(affectedEntities));
      queueIndexNow(affectedYearEntities.flatMap((candidate) => [
        phase3bYearUrl(candidate.entity, candidate.year),
        phase3aEntityUrl(candidate.entity),
      ]));
    }
  } catch (err) {
    logger.warn({ err }, "active inventory stale refresh failed");
  }
}

async function qualifiedCutoff(): Promise<Date> {
  await refreshStaleInventory();
  return new Date(Date.now() - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
}

export async function qualifiedInventoryCount(): Promise<number> {
  const cutoff = await qualifiedCutoff();
  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(activeInventory)
    .where(qualifiedInventoryWhere(cutoff));
  return Number(result?.count || 0);
}

export async function qualifiedVehicleShard(offset: number, limit: number): Promise<
  Pick<ActiveInventory, "vin" | "updatedAt">[]
> {
  const cutoff = await qualifiedCutoff();
  return db.select({ vin: activeInventory.vin, updatedAt: activeInventory.updatedAt })
    .from(activeInventory)
    .where(qualifiedInventoryWhere(cutoff))
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
    .where(qualifiedInventoryWhere(cutoff))
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
    .where(and(
      qualifiedInventoryWhere(cutoff),
      sql`lower(trim(${activeInventory.make})) = ${make.trim().toLocaleLowerCase("en-US")}`,
      sql`lower(trim(${activeInventory.model})) = ${model.trim().toLocaleLowerCase("en-US")}`,
    ))
    .orderBy(activeInventory.vin)
    .limit(limit)
    .offset(offset);
}
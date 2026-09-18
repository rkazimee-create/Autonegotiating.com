import { and, eq, gte, sql } from "drizzle-orm";
import { activeInventory } from "@workspace/db";

const DEFAULT_FRESHNESS_DAYS = 30;
const MIN_FRESHNESS_DAYS = 1;
const MAX_FRESHNESS_DAYS = 365;
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const INVENTORY_FRESHNESS_DAYS = (() => {
  const parsed = Number(process.env.INVENTORY_FRESHNESS_DAYS);
  if (!Number.isFinite(parsed)) return DEFAULT_FRESHNESS_DAYS;
  return Math.min(MAX_FRESHNESS_DAYS, Math.max(MIN_FRESHNESS_DAYS, Math.floor(parsed)));
})();

export function isValidInventoryVin(value: unknown): value is string {
  return typeof value === "string" && VIN_PATTERN.test(value.trim());
}

export function qualifiedInventoryWhere(cutoff: Date) {
  return and(
    eq(activeInventory.active, true),
    gte(activeInventory.lastSeen, cutoff),
    sql`${activeInventory.vin} ~* '^[A-HJ-NPR-Z0-9]{17}$'`,
    sql`length(trim(${activeInventory.make})) > 0`,
    sql`length(trim(${activeInventory.model})) > 0`,
  )!;
}
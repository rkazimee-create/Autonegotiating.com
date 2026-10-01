import { and, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, activeInventory, type ActiveInventory } from "@workspace/db";
import { INVENTORY_FRESHNESS_DAYS, qualifiedInventoryWhere } from "./inventory-qualification";
import {
  renderVehicleNotFoundPage,
  renderVehiclePage,
} from "./vehicle-page";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

export type PersistedVehicleLookup = (vin: string) => Promise<ActiveInventory | undefined>;

export async function findQualifiedPersistedVehicle(vin: string): Promise<ActiveInventory | undefined> {
  const cutoff = new Date(Date.now() - INVENTORY_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
  const [record] = await db.select().from(activeInventory).where(and(
    eq(activeInventory.vin, vin),
    qualifiedInventoryWhere(cutoff),
  )).limit(1);
  return record;
}

export function persistedVehicleListing(record: ActiveInventory): Record<string, unknown> {
  return {
    vin: record.vin,
    year: record.year,
    make: record.make,
    model: record.model,
    trim: record.trim,
    condition: record.condition,
    price: record.price,
    mileage: record.mileage,
    dealerName: record.dealerName,
    city: record.dealerCity,
    state: record.dealerState,
    dealerListingUrl: record.sourceUrl,
    active: record.active,
  };
}

export function createPersistedVehiclePageHandler(
  lookup: PersistedVehicleLookup = findQualifiedPersistedVehicle,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawVin = Array.isArray(req.params.vin) ? req.params.vin[0] : req.params.vin;
    const vin = String(rawVin || "").trim().toUpperCase();

    if (!VIN_PATTERN.test(vin)) {
      res.status(404).type("html").send(renderVehicleNotFoundPage(vin || "unknown"));
      return;
    }

    if (rawVin !== vin) {
      res.redirect(301, `/vehicle/${encodeURIComponent(vin)}`);
      return;
    }

    try {
      const record = await lookup(vin);
      if (!record) {
        res.status(404).type("html").send(renderVehicleNotFoundPage(vin));
        return;
      }
      res.type("html").send(renderVehiclePage(persistedVehicleListing(record), vin));
    } catch (err) {
      req.log.error({ err, vin }, "vehicle page persisted inventory lookup failed");
      res.status(503).type("html").send("Vehicle inventory temporarily unavailable");
    }
  };
}
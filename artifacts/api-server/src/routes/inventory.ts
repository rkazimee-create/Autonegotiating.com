import { Router, type IRouter } from "express";
import { autodevGet, autodevV2Get } from "../lib/autodev";
import { logger } from "../lib/logger";
import { cache, TTL } from "../lib/cache";
import { db, priceSnapshots } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

function recordPriceSnapshots(listings: Array<Record<string, unknown>>) {
  const today = new Date().toISOString().split("T")[0];
  const records = listings
    .filter((l) => l.vin && typeof l.priceUnformatted === "number" && (l.priceUnformatted as number) > 0)
    .map((l) => ({
      vin: l.vin as string,
      price: Math.round(l.priceUnformatted as number),
      priceDate: today,
    }));

  if (!records.length) return;

  db.insert(priceSnapshots)
    .values(records)
    .onConflictDoUpdate({
      target: [priceSnapshots.vin, priceSnapshots.priceDate],
      set: {
        price: sql`excluded.price`,
        observedAt: sql`now()`,
      },
    })
    .catch((err) => logger.warn({ err }, "price snapshot upsert failed"));
}

router.get("/inventory", async (req, res): Promise<void> => {
  const {
    zip,
    distance = "50",
    make,
    model,
    condition,
    minYear,
    maxYear,
    minPrice,
    maxPrice,
    bodyStyle,
    trim,
    sort,
    page = "1",
    limit = "12",
  } = req.query as Record<string, string>;

  if (!zip) {
    res.status(400).json({ error: "zip is required" });
    return;
  }

  try {
    const normalizedTrim =
      make?.toLowerCase() === "bmw" &&
      model?.toLowerCase() === "x7" &&
      trim?.toLowerCase() === "alpina xb7"
        ? "ALPINA XB7"
        : trim;

    if (sort && sort !== "default") {
      const sortMap: Record<string, string> = {
        "price-asc": "price.asc",
        "price-desc": "price.desc",
        "year-desc": "year.desc",
        "year-asc": "year.asc",
        "mileage-asc": "mileage.asc",
      };
      const apiSort = sortMap[sort];
      if (!apiSort) {
        res.status(400).json({ error: "Unsupported inventory sort" });
        return;
      }

      const yearRange = minYear || maxYear
        ? `${minYear || "1900"}-${maxYear || new Date().getFullYear() + 1}`
        : undefined;
      const priceRange = minPrice || maxPrice
        ? `${minPrice || "0"}-${maxPrice || "99999999"}`
        : undefined;

      const v2Params: Record<string, string | number | boolean | undefined> = {
        zip,
        distance,
        page,
        limit,
        sort: apiSort,
        includes: "total",
        "vehicle.make": make,
        "vehicle.model": model,
        "vehicle.trim": normalizedTrim,
        "vehicle.bodyStyle": bodyStyle,
        "vehicle.year": yearRange,
        "retailListing.price": priceRange,
        "retailListing.used": condition === "used" ? true : condition === "new" ? false : undefined,
      };

      const result = await autodevV2Get("/listings", v2Params) as {
        total?: number;
        data?: Array<Record<string, unknown>>;
      };
      const listings = (result.data || []).map((row) => {
        const vehicle = (row.vehicle || {}) as Record<string, unknown>;
        const retail = (row.retailListing || {}) as Record<string, unknown>;
        const location = Array.isArray(row.location) ? row.location : [];
        return {
          id: row.vin,
          vin: row.vin,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
          displayColor: vehicle.exteriorColor,
          bodyStyle: vehicle.bodyStyle,
          engine: vehicle.engine,
          transmission: vehicle.transmission,
          drivetrain: vehicle.drivetrain,
          fuelType: vehicle.fuel,
          price: retail.price,
          priceUnformatted: retail.price,
          mileageUnformatted: retail.miles,
          condition: retail.used ? "used" : "new",
          dealerName: retail.dealer,
          city: retail.city,
          state: retail.state,
          primaryPhotoUrl: retail.primaryImage,
          photoUrls: retail.primaryImage ? [retail.primaryImage] : [],
          vdpUrl: retail.vdp,
          carfaxUrl: retail.carfaxUrl,
          history: row.history,
          createdAt: row.createdAt,
          lon: location[0],
          lat: location[1],
        };
      });

      if (listings.length) recordPriceSnapshots(listings);
      res.json({ records: listings, totalCount: result.total || listings.length });
      return;
    }

    const params: Record<string, string | number | undefined> = {
      zip,
      radius: distance,
      page,
      limit,
    };
    if (make) params.make = make;
    if (model) params.model = model;
    if (condition) params.condition = condition;
    if (minYear) params.year_min = minYear;
    if (maxYear) params.year_max = maxYear;
    if (minPrice) params.price_min = minPrice;
    if (maxPrice) params.price_max = maxPrice;
    if (bodyStyle) params.body_style = bodyStyle;
    if (normalizedTrim) params.trim = normalizedTrim;

    const cacheKey = `inventory:${JSON.stringify(params)}`;
    const data = await cache.getOrFetch(cacheKey, TTL.INVENTORY, async () => {
      const result = await autodevGet("/listings", params);
      const dataObj = result as Record<string, unknown[]>;
      const listings = dataObj.records || dataObj.listings || dataObj.data || [];
      // Don't cache empty results — let next request retry auto.dev
      if (!listings.length) throw new Error("empty inventory response");
      return result;
    }).catch(async (err) => {
      // If cache miss threw (empty result), still try to return data
      if ((err as Error).message === "empty inventory response") {
        return await autodevGet("/listings", params);
      }
      throw err;
    });

    // Fire-and-forget: record price snapshots for all returned listings
    const dataObj = data as Record<string, unknown[]>;
    const listings = dataObj.records || dataObj.listings || dataObj.data || [];
    if (listings.length) {
      recordPriceSnapshots(listings as Array<Record<string, unknown>>);
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "inventory fetch failed");
    res.status(502).json({ error: "Failed to fetch inventory from auto.dev" });
  }
});

export default router;

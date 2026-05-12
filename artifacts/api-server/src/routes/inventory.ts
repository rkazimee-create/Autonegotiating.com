import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";
import { logger } from "../lib/logger";
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
    page = "1",
    limit = "12",
  } = req.query as Record<string, string>;

  if (!zip) {
    res.status(400).json({ error: "zip is required" });
    return;
  }

  try {
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
    if (trim) params.trim = trim;

    const data = await autodevGet("/listings", params);

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

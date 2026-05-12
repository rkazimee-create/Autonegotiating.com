import { Router, type IRouter } from "express";
import { db, priceSnapshots } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/price-history", async (req, res): Promise<void> => {
  const { vin } = req.query as Record<string, string>;
  if (!vin) {
    res.status(400).json({ error: "vin is required" });
    return;
  }

  try {
    const rows = await db
      .select({ price: priceSnapshots.price, date: priceSnapshots.priceDate })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.vin, vin))
      .orderBy(asc(priceSnapshots.priceDate))
      .limit(90);

    res.json({ vin, history: rows });
  } catch (err) {
    req.log.error({ err }, "price-history fetch failed");
    res.status(500).json({ error: "Failed to fetch price history" });
  }
});

export default router;

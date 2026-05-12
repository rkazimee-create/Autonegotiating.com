import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";

const router: IRouter = Router();

function parsePrice(rec: Record<string, unknown>): number {
  return (
    Number(rec.priceUnformatted) ||
    Number(rec.basePrice) ||
    (typeof rec.price === "string"
      ? parseFloat((rec.price as string).replace(/[^0-9.]/g, ""))
      : Number(rec.price)) ||
    0
  );
}

function parseMileage(rec: Record<string, unknown>): number {
  return Number(rec.mileageUnformatted) || Number(rec.mileage) || 0;
}

function daysAgo(dateStr: unknown): number | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  return ms > 0 ? Math.floor(ms / (1000 * 60 * 60 * 24)) : null;
}

function parsePriceDrop(rec: Record<string, unknown>): number | null {
  const drop = rec.recentPriceDrop;
  if (!drop) return null;
  if (typeof drop === "number") return drop;
  if (typeof drop === "object" && drop !== null) {
    const d = drop as Record<string, unknown>;
    return Number(d.amount) || Number(d.drop) || Number(d.value) || null;
  }
  return null;
}

router.get("/comparables", async (req, res): Promise<void> => {
  const {
    make,
    model,
    year,
    trim,
    condition,
    price,
    mileage,
  } = req.query as Record<string, string>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  try {
    const params: Record<string, string | number | undefined> = {
      make,
      model,
      radius: 500,
      limit: 50,
    };
    if (year) params.year_min = year;
    if (year) params.year_max = year;
    if (trim) params.trim = trim;
    if (condition) params.condition = condition;

    const data = (await autodevGet("/listings", params)) as {
      records?: Record<string, unknown>[];
      data?: Record<string, unknown>[];
      listings?: Record<string, unknown>[];
    };

    const raw = data.records || data.data || data.listings || [];

    if (raw.length === 0) {
      res.json({ comparables: [], stats: { count: 0 } });
      return;
    }

    // Normalize each listing into typed fields
    const normalized = raw.map((r) => {
      const rec = r as Record<string, unknown>;
      const p = parsePrice(rec);
      const m = parseMileage(rec);
      const dol = daysAgo(rec.createdAt);
      const drop = parsePriceDrop(rec);
      return {
        id: rec.id,
        vin: rec.vin,
        year: rec.year,
        make: rec.make,
        model: rec.model,
        trim: rec.trim,
        color: rec.displayColor || rec.color,
        condition: rec.condition,
        price: p,
        mileage: m,
        city: rec.city,
        state: rec.state,
        daysOnLot: dol,
        priceDrop: drop,
        dealerName: rec.dealerName,
        photoUrl: rec.primaryPhotoUrl || rec.thumbnailUrl,
        vdpUrl: rec.vdpUrl,
        clickoffUrl: rec.clickoffUrl,
        createdAt: rec.createdAt,
      };
    });

    const prices = normalized.map((n) => n.price).filter((p) => p > 0);
    const mileages = normalized.map((n) => n.mileage).filter((m) => m > 0);
    const dolValues = normalized.map((n) => n.daysOnLot).filter((d): d is number => d !== null);
    const dropsCount = normalized.filter((n) => n.priceDrop !== null).length;

    const avg = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : 0;
    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices) : 0;
    const avgMileage = mileages.length
      ? Math.round(mileages.reduce((a, b) => a + b, 0) / mileages.length)
      : 0;
    const avgDaysOnLot = dolValues.length
      ? Math.round(dolValues.reduce((a, b) => a + b, 0) / dolValues.length)
      : null;
    const pctWithPriceDrop =
      normalized.length > 0
        ? Math.round((dropsCount / normalized.length) * 100)
        : 0;

    const listingPrice = Number(price) || 0;
    const cheaperCount = prices.filter((p) => p < listingPrice).length;
    const pricePosition =
      listingPrice && prices.length
        ? Math.round((cheaperCount / prices.length) * 100)
        : null;

    res.json({
      comparables: normalized.slice(0, 10),
      stats: {
        count: raw.length,
        avgPrice: avg,
        minPrice: minP,
        maxPrice: maxP,
        avgMileage,
        pricePosition,
        avgDaysOnLot,
        pctWithPriceDrop,
      },
    });
  } catch (err) {
    req.log.error({ err }, "comparables fetch failed");
    res.status(502).json({ error: "Failed to fetch comparables" });
  }
});

export default router;

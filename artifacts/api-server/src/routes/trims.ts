import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";
import { cache, TTL } from "../lib/cache";
import { getStaticTrims } from "../lib/static-trims";

const router: IRouter = Router();

router.get("/trims", async (req, res): Promise<void> => {
  const { make, model } = req.query as Record<string, string>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  // Serve from the static curated list first — zero API calls, instant.
  // Falls through to auto.dev only for makes/models not in the static list.
  const staticTrims = getStaticTrims(make, model);
  if (staticTrims) {
    res.json({ trims: staticTrims });
    return;
  }

  const cacheKey = `trims:${make.toLowerCase()}:${model.toLowerCase()}`;

  try {
    const trimNames = await cache.getOrFetch<string[]>(cacheKey, TTL.TRIMS, async () => {
      const data = (await autodevGet("/listings", {
        make,
        model,
        zip: "66101",
        distance: 5000,
        limit: 10,
      })) as { records?: { trim?: string }[] };

      const records = data.records || [];
      let names = [
        ...new Set(
          records
            .map((r) => r.trim)
            .filter((t): t is string => typeof t === "string" && t.trim() !== ""),
        ),
      ].sort();

      if (names.length === 0) {
        const data2 = (await autodevGet("/listings", {
          make,
          model,
          zip: "90210",
          distance: 5000,
          limit: 10,
        })) as { records?: { trim?: string }[] };
        const records2 = data2.records || [];
        names = [
          ...new Set(
            records2
              .map((r) => r.trim)
              .filter((t): t is string => typeof t === "string" && t.trim() !== ""),
          ),
        ].sort();
      }

      if (names.length === 0) throw new Error("no trims returned");

      return names;
    });

    res.json({ trims: trimNames });
  } catch (err) {
    req.log.error({ err }, "trims fetch failed");
    res.json({ trims: [] });
  }
});

export default router;

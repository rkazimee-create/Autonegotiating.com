import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";

const router: IRouter = Router();

router.get("/trims", async (req, res): Promise<void> => {
  const { make, model } = req.query as Record<string, string>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  try {
    // Use a central US zip with max radius to cast the widest net nationwide
    const data = (await autodevGet("/listings", {
      make,
      model,
      zip: "66101",
      distance: 5000,
      limit: 50,
    })) as {
      records?: { trim?: string }[];
    };

    const records = data.records || [];
    let trimNames = [
      ...new Set(
        records
          .map((r) => r.trim)
          .filter((t): t is string => typeof t === "string" && t.trim() !== ""),
      ),
    ].sort();

    // If first pass returned nothing, retry from the West Coast
    if (trimNames.length === 0) {
      const data2 = (await autodevGet("/listings", {
        make,
        model,
        zip: "90210",
        distance: 5000,
        limit: 50,
      })) as { records?: { trim?: string }[] };
      const records2 = data2.records || [];
      trimNames = [
        ...new Set(
          records2
            .map((r) => r.trim)
            .filter((t): t is string => typeof t === "string" && t.trim() !== ""),
        ),
      ].sort();
    }

    res.json({ trims: trimNames });
  } catch (err) {
    req.log.error({ err }, "trims fetch failed");
    res.json({ trims: [] });
  }
});

export default router;

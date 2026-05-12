import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";

const router: IRouter = Router();

router.get("/vin-decode", async (req, res): Promise<void> => {
  const { vin } = req.query as Record<string, string>;
  if (!vin || vin.length < 11) {
    res.status(400).json({ error: "Valid VIN required" });
    return;
  }

  try {
    const data = await autodevGet(`/vin/${vin}`, {});
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "VIN decode failed");
    res.status(502).json({ error: "VIN decode failed" });
  }
});

router.get("/vin-data", async (req, res): Promise<void> => {
  const { vin } = req.query as Record<string, string>;
  if (!vin || vin.length < 11) {
    res.status(400).json({ error: "Valid VIN required" });
    return;
  }

  try {
    const data = await autodevGet(`/vin/${vin}`, {});
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "VIN data fetch failed");
    res.status(502).json({ error: "VIN data fetch failed" });
  }
});

export default router;

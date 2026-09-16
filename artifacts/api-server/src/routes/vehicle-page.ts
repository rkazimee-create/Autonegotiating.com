import { Router, type IRouter } from "express";
import { autodevGet } from "../lib/autodev";
import { cache, TTL } from "../lib/cache";
import {
  extractListings,
  renderVehicleNotFoundPage,
  renderVehiclePage,
  renderVehicleTemporaryErrorPage,
} from "../lib/vehicle-page";

const router: IRouter = Router();
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

router.get("/vehicle/:vin", async (req, res): Promise<void> => {
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
    const result = await cache.getOrFetch(
      `vehicle-page:${vin}`,
      TTL.INVENTORY,
      () => autodevGet("/listings", { vin, page: 1, limit: 1 }),
    );
    const listing = extractListings(result).find(
      (candidate) => String(candidate.vin || "").trim().toUpperCase() === vin && candidate.active !== false,
    );

    if (!listing) {
      res.status(404).type("html").send(renderVehicleNotFoundPage(vin));
      return;
    }

    res.type("html").send(renderVehiclePage(listing, vin));
  } catch (err) {
    req.log.error({ err, vin }, "vehicle page lookup failed");
    res
      .status(503)
      .set("Retry-After", "60")
      .type("html")
      .send(renderVehicleTemporaryErrorPage(vin));
  }
});

export default router;
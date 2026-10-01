import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
declare const __SEO_READ_SAFETY_DIGEST__: string;

router.get("/healthz", (_req, res) => {
  // Build-time attestation only: no database, external API, or maintenance work.
  // Allows the smoke runner to refuse old production builds before any SEO reads.
  res.set("X-SEO-Read-Safety", __SEO_READ_SAFETY_DIGEST__);
  res.set("Cache-Control", "no-store");
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;

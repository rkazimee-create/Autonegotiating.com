import { Router } from "express";

const router = Router();

router.post("/promo/validate", async (req, res) => {
  const code = req.body?.code;
  if (typeof code !== "string" || !code.trim()) {
    res.status(400).json({ valid: false, message: "Invalid request." });
    return;
  }

  const submitted = code.trim().toUpperCase();

  const raw = process.env.PROMO_CODES || process.env.PROMO_CODE || "";
  const validCodes = raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (validCodes.length === 0) {
    req.log.warn("No PROMO_CODES env var configured");
    res.status(503).json({ valid: false, message: "Promo codes are not configured." });
    return;
  }

  const valid = validCodes.includes(submitted);
  req.log.info({ submitted, valid }, "promo code attempt");

  res.json({
    valid,
    message: valid ? "Access granted — enjoy your free report!" : "Invalid promo code. Please check the code and try again.",
  });
});

export default router;

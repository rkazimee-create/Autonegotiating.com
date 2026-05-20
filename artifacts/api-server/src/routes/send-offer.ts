import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/api/send-offer", async (req, res) => {
  const { to, dealerName, subject, body, buyerEmail, buyerName, buyerPhone } =
    req.body as {
      to: string;
      dealerName?: string;
      subject: string;
      body: string;
      buyerEmail?: string | null;
      buyerName?: string | null;
      buyerPhone?: string | null;
    };

  if (!to || !subject || !body) {
    res.status(400).json({ error: "Missing required fields: to, subject, body" });
    return;
  }

  try {
    // Log the offer details — email sending requires an email provider (e.g. SendGrid)
    // to be configured in Replit. Locally this logs the offer instead.
    logger.info(
      { to, dealerName, subject, buyerEmail, buyerName, buyerPhone },
      "Offer submission received",
    );

    // TODO: wire up email provider (SendGrid / Resend / etc.) when available
    // For now return success so the UI flow works end-to-end locally
    res.json({ success: true, message: "Offer submitted successfully." });
  } catch (err) {
    logger.error({ err }, "Failed to send offer");
    res.status(500).json({ error: "Failed to send offer" });
  }
});

export default router;

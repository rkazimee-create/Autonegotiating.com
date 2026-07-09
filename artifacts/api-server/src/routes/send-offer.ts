import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/resend";
import { db, offerThreads, offerMessages } from "@workspace/db";

const router: IRouter = Router();

// Replies from dealers land on <alias>@REPLY_DOMAIN and get relayed to the
// buyer's real inbox — the dealer never sees the buyer's real address.
// Requires REPLY_DOMAIN's MX records to point at Resend's inbound service
// and inbound routing configured in the Resend dashboard for that domain.
const REPLY_DOMAIN = process.env.OFFER_REPLY_DOMAIN || "reply.autonegotiating.com";
const SEND_FROM = process.env.OFFER_SEND_FROM || "AutoNegotiating.com <offers@autonegotiating.com>";

router.post("/send-offer", async (req, res) => {
  const { to, dealerName, subject, body, buyerEmail, buyerName, buyerPhone, vin, anonymous } =
    req.body as {
      to: string;
      dealerName?: string;
      subject: string;
      body: string;
      buyerEmail?: string | null;
      buyerName?: string | null;
      buyerPhone?: string | null;
      vin?: string | null;
      anonymous?: boolean;
    };

  if (!to || !subject || !body) {
    res.status(400).json({ error: "Missing required fields: to, subject, body" });
    return;
  }

  if (!buyerEmail) {
    res.status(400).json({ error: "buyerEmail is required so we can relay dealer replies back to you" });
    return;
  }

  const replyAlias = `offer-${randomBytes(6).toString("hex")}@${REPLY_DOMAIN}`;

  try {
    const [thread] = await db
      .insert(offerThreads)
      .values({
        clerkId: (req as any).auth?.userId ?? "anon",
        vin: vin ?? null,
        dealerName: dealerName ?? null,
        dealerEmail: to,
        buyerEmail,
        buyerName: buyerName ?? null,
        anonymous: !!anonymous,
        replyAlias,
      })
      .returning();

    // If the buyer opted to stay anonymous, strip their real name from the
    // outgoing body and replace with a neutral client reference.
    const finalBody = anonymous && buyerName
      ? body.split(buyerName).join(`AutoNegotiating.com Client #${thread.id}`)
      : body;

    await sendEmail({
      from: SEND_FROM,
      to,
      subject,
      text: finalBody,
      replyTo: replyAlias,
    });

    await db.insert(offerMessages).values({
      threadId: thread.id,
      direction: "outbound",
      fromEmail: SEND_FROM,
      toEmail: to,
      subject,
      body: finalBody,
    });

    logger.info({ to, dealerName, threadId: thread.id, anonymous: !!anonymous }, "Offer email sent");

    res.json({ success: true, message: "Offer submitted successfully.", threadId: thread.id });
  } catch (err) {
    logger.error({ err }, "Failed to send offer");
    res.status(500).json({ error: "Failed to send offer" });
  }
});

export default router;

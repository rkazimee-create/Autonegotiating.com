import type { Response } from "express";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/resend";
import { db, offerThreads, offerMessages } from "@workspace/db";
import { eq } from "drizzle-orm";

const SEND_FROM = process.env.OFFER_SEND_FROM || "AutoNegotiating.com <offers@autonegotiating.com>";

// Resend inbound webhook handler — fires when a dealer replies to their
// offer-reply alias. We look up the thread by alias and relay the message to
// the buyer's real inbox, so the dealer never learns the buyer's real email
// address.
//
// This is called from app.ts AFTER Svix signature verification has already
// validated the request and parsed the raw body into `payload`.
export async function handleInboundEmail(payload: unknown, res: Response) {
  try {
    const data = payload as {
      type?: string;
      data?: {
        to?: string[] | string;
        from?: string;
        subject?: string;
        text?: string;
        html?: string;
      };
    };

    const toField = data.data?.to;
    const toAddress = Array.isArray(toField) ? toField[0] : toField;
    const alias = toAddress?.toLowerCase().trim();

    if (!alias) {
      res.status(400).json({ error: "No recipient alias found in inbound payload" });
      return;
    }

    const [thread] = await db
      .select()
      .from(offerThreads)
      .where(eq(offerThreads.replyAlias, alias))
      .limit(1);

    if (!thread) {
      logger.warn({ alias }, "Inbound email received for unknown offer thread alias");
      res.status(404).json({ error: "Unknown thread" });
      return;
    }

    const dealerMessage = data.data?.text || data.data?.html || "(no content)";
    const dealerFrom = data.data?.from || thread.dealerEmail;

    const relaySubject = `Re: Offer on your vehicle — dealer reply via AutoNegotiating.com`;
    const relayBody = `Your dealer contact${thread.dealerName ? ` (${thread.dealerName})` : ""} replied to your offer:\n\n${dealerMessage}\n\n---\nReply to this email and we'll forward your response back to the dealer. Your real email address is never shared with the dealer.`;

    await sendEmail({
      from: SEND_FROM,
      to: thread.buyerEmail,
      subject: relaySubject,
      text: relayBody,
      replyTo: thread.replyAlias,
    });

    await db.insert(offerMessages).values({
      threadId: thread.id,
      direction: "inbound",
      fromEmail: dealerFrom,
      toEmail: thread.buyerEmail,
      subject: relaySubject,
      body: dealerMessage,
    });

    logger.info({ threadId: thread.id }, "Relayed dealer reply to buyer");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to process inbound email webhook");
    res.status(500).json({ error: "Failed to process inbound email" });
  }
}

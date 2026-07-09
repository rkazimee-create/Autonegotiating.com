import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

// Resend integration (connection:conn_resend_01KRFD5WPX98K7H7M5H64XCPZ4).
// The connectors SDK proxies authenticated requests to the Resend API —
// no API key handling needed on our side.
const connectors = new ReplitConnectors();

export interface SendEmailArgs {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      ...(args.replyTo ? { reply_to: [args.replyTo] } : {}),
    }),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    logger.error({ status: response.status, errText }, "Resend send failed");
    throw new Error(`Resend send failed: ${response.status} ${errText}`);
  }
}

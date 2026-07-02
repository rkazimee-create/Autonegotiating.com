import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripeClient";

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe initialization");
    return;
  }
  try {
    logger.info("Running Stripe schema migrations...");
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();

    // Only register the webhook in production — dev uses an ephemeral janeway.replit.dev
    // domain that Stripe cannot reach, and each dev restart would overwrite the production URL.
    const isProduction = process.env.NODE_ENV === "production";
    const domains = process.env.REPLIT_DOMAINS ?? "";
    const primaryDomain = domains.split(",")[0];
    if (isProduction && primaryDomain) {
      const webhookUrl = `https://${primaryDomain}/api/stripe/webhook`;
      logger.info({ webhookUrl }, "Setting up managed webhook");
      // Non-fatal — webhook setup can fail if stripe schema tables are still being created
      stripeSync.findOrCreateManagedWebhook(webhookUrl)
        .then(() => logger.info("Webhook configured"))
        .catch((err: any) => logger.warn({ err: err.message }, "Webhook setup deferred — will retry on next restart"));
    } else if (!isProduction) {
      logger.info("Skipping webhook registration in development — production URL not available");
    }

    // Run backfill in background — don't block startup
    stripeSync
      .syncBackfill()
      .then(() => logger.info("Stripe data synced"))
      .catch((err) => logger.warn({ err }, "Stripe backfill skipped — schema may still be initializing"));
  } catch (err) {
    logger.error({ err }, "Stripe initialization failed — server will continue without Stripe sync");
  }
}

const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

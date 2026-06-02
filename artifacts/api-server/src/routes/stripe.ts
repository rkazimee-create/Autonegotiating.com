import { Router, type IRouter } from "express";
import { stripeStorage } from "../lib/stripeStorage";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripeClient";

const router: IRouter = Router();

const DEAL_INTEL_METADATA_KEY = "autonegotiating_product";
const DEAL_INTEL_METADATA_VAL = "deal-intelligence";
const OFFER_ACCESS_METADATA_VAL = "offer-access";
const SUBSCRIPTION_METADATA_VAL = "subscription";

let cachedDealIntelPriceId: string | null = null;
let cachedOfferPriceId: string | null = null;
let cachedMonthlyPriceId: string | null = null;
let cachedAnnualPriceId: string | null = null;

async function ensureDealIntelPrice(): Promise<string> {
  if (cachedDealIntelPriceId) return cachedDealIntelPriceId;

  const stripe = await getUncachableStripeClient();

  // Search for existing product by metadata
  const products = await stripe.products.search({
    query: `metadata["${DEAL_INTEL_METADATA_KEY}"]:"${DEAL_INTEL_METADATA_VAL}"`,
  });

  let productId: string;
  let priceId: string | null = null;

  if (products.data.length > 0) {
    productId = products.data[0].id;
    // Find existing active price
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
    const existing = prices.data.find(p => p.unit_amount === 999 && p.currency === "usd" && p.type === "one_time");
    if (existing) priceId = existing.id;
  } else {
    // Create product
    const product = await stripe.products.create({
      name: "Deal Intelligence Report",
      description: "AI-powered deal analysis: fair market value, negotiation leverage, and a ready-to-send offer email.",
      metadata: { [DEAL_INTEL_METADATA_KEY]: DEAL_INTEL_METADATA_VAL },
    });
    productId = product.id;
  }

  if (!priceId) {
    // Create $9.99 one-time price
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: 999,
      currency: "usd",
    });
    priceId = price.id;
  }

  cachedDealIntelPriceId = priceId;
  return priceId;
}

async function ensureOfferAccessPrice(): Promise<string> {
  if (cachedOfferPriceId) return cachedOfferPriceId;

  const stripe = await getUncachableStripeClient();

  const products = await stripe.products.search({
    query: `metadata["${DEAL_INTEL_METADATA_KEY}"]:"${OFFER_ACCESS_METADATA_VAL}"`,
  });

  let productId: string;
  let priceId: string | null = null;

  if (products.data.length > 0) {
    productId = products.data[0].id;
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
    const existing = prices.data.find(p => p.unit_amount === 999 && p.currency === "usd" && p.type === "one_time");
    if (existing) priceId = existing.id;
  } else {
    const product = await stripe.products.create({
      name: "Offer Submission Access",
      description: "Verified buyer offer submission — professional offer email sent to the dealer's internet sales team on your behalf. One-time purchase, never expires.",
      metadata: { [DEAL_INTEL_METADATA_KEY]: OFFER_ACCESS_METADATA_VAL },
    });
    productId = product.id;
  }

  if (!priceId) {
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: 999,
      currency: "usd",
    });
    priceId = price.id;
  }

  cachedOfferPriceId = priceId;
  return priceId;
}

async function ensureSubscriptionPrices(): Promise<{ monthlyPriceId: string; annualPriceId: string }> {
  if (cachedMonthlyPriceId && cachedAnnualPriceId) {
    return { monthlyPriceId: cachedMonthlyPriceId, annualPriceId: cachedAnnualPriceId };
  }

  const stripe = await getUncachableStripeClient();

  const products = await stripe.products.search({
    query: `metadata["${DEAL_INTEL_METADATA_KEY}"]:"${SUBSCRIPTION_METADATA_VAL}"`,
  });

  let productId: string;
  if (products.data.length > 0) {
    productId = products.data[0].id;
  } else {
    const product = await stripe.products.create({
      name: "AutoNegotiating Pro",
      description: "Unlimited deal intelligence reports, offer submissions, and negotiation tools — all paywalls bypassed while your subscription is active.",
      metadata: { [DEAL_INTEL_METADATA_KEY]: SUBSCRIPTION_METADATA_VAL },
    });
    productId = product.id;
  }

  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });

  let monthlyPriceId = prices.data.find(
    (p) => p.recurring?.interval === "month" && p.unit_amount === 2000
  )?.id ?? null;
  let annualPriceId = prices.data.find(
    (p) => p.recurring?.interval === "year" && p.unit_amount === 20000
  )?.id ?? null;

  if (!monthlyPriceId) {
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });
    monthlyPriceId = price.id;
  }

  if (!annualPriceId) {
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: 20000,
      currency: "usd",
      recurring: { interval: "year" },
    });
    annualPriceId = price.id;
  }

  cachedMonthlyPriceId = monthlyPriceId;
  cachedAnnualPriceId = annualPriceId;
  return { monthlyPriceId, annualPriceId };
}

router.get("/stripe/config", async (req, res) => {
  try {
    const [publishableKey, priceId, offerPriceId, { monthlyPriceId, annualPriceId }] = await Promise.all([
      getStripePublishableKey(),
      ensureDealIntelPrice(),
      ensureOfferAccessPrice(),
      ensureSubscriptionPrices(),
    ]);
    res.json({ publishableKey, priceId, offerPriceId, monthlyPriceId, annualPriceId });
  } catch (err: any) {
    req.log.error({ err }, "Failed to get Stripe config");
    res.status(500).json({ error: "Stripe not configured" });
  }
});

router.get("/stripe/products", async (req, res) => {
  try {
    const rows = await stripeStorage.listProductsWithPrices();
    const productsMap = new Map<string, any>();
    for (const row of rows) {
      if (!productsMap.has(row.product_id as string)) {
        productsMap.set(row.product_id as string, {
          id: row.product_id,
          name: row.product_name,
          description: row.product_description,
          active: row.product_active,
          prices: [],
        });
      }
      if (row.price_id) {
        productsMap.get(row.product_id as string).prices.push({
          id: row.price_id,
          unit_amount: row.unit_amount,
          currency: row.currency,
          recurring: row.recurring,
          type: row.price_type,
          active: row.price_active,
        });
      }
    }
    res.json({ data: Array.from(productsMap.values()) });
  } catch (err: any) {
    req.log.error({ err }, "Failed to list Stripe products");
    res.status(500).json({ error: "Failed to load products" });
  }
});

router.post("/stripe/checkout", async (req, res) => {
  try {
    const { priceId, email, successUrl, cancelUrl } = req.body as {
      priceId: string;
      email?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!priceId) {
      res.status(400).json({ error: "priceId is required" });
      return;
    }

    const stripe = await getUncachableStripeClient();

    // Try DB first, fall back to Stripe API (handles case where sync hasn't run yet)
    let priceType = "one_time";
    const dbPrice = await stripeStorage.getPrice(priceId);
    if (dbPrice) {
      priceType = (dbPrice as any).type ?? "one_time";
    } else {
      try {
        const stripePrice = await stripe.prices.retrieve(priceId);
        priceType = stripePrice.type;
      } catch {
        res.status(404).json({ error: "Price not found" });
        return;
      }
    }

    const baseUrl = `https://${(process.env.REPLIT_DOMAINS ?? "").split(",")[0]}`;
    const mode = priceType === "recurring" ? "subscription" : "payment";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url: successUrl ?? `${baseUrl}/deal-intelligence?session_id={CHECKOUT_SESSION_ID}&payment=success`,
      cancel_url: cancelUrl ?? `${baseUrl}/deal-intelligence?payment=cancelled`,
      ...(email ? { customer_email: email } : {}),
      metadata: { price_id: priceId },
      ...(mode === "subscription" ? {
        payment_method_collection: "always",
        subscription_data: { trial_period_days: 30 },
      } : {}),
    });

    res.json({ url: session.url });
  } catch (err: any) {
    req.log.error({ err }, "Failed to create checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/stripe/embedded-subscription", async (req, res) => {
  try {
    const { priceId, returnUrl } = req.body as {
      priceId: string;
      returnUrl: string;
    };

    if (!priceId || !returnUrl) {
      res.status(400).json({ error: "priceId and returnUrl are required" });
      return;
    }

    const stripe = await getUncachableStripeClient();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      ui_mode: "embedded",
      return_url: returnUrl,
      subscription_data: { trial_period_days: 30 },
    });

    res.json({ clientSecret: session.client_secret });
  } catch (err: any) {
    req.log.error({ err }, "Failed to create embedded subscription session");
    res.status(500).json({ error: "Failed to create subscription session" });
  }
});

router.post("/stripe/embedded-checkout", async (req, res) => {
  try {
    const { priceId, returnUrl } = req.body as {
      priceId: string;
      returnUrl: string;
    };

    if (!priceId || !returnUrl) {
      res.status(400).json({ error: "priceId and returnUrl are required" });
      return;
    }

    const stripe = await getUncachableStripeClient();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "payment",
      ui_mode: "embedded",
      return_url: returnUrl,
      metadata: { price_id: priceId },
    });

    res.json({ clientSecret: session.client_secret });
  } catch (err: any) {
    req.log.error({ err }, "Failed to create embedded checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.get("/stripe/subscription-status", async (req, res) => {
  try {
    const { email } = req.query as { email?: string };
    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const customers = await stripe.customers.list({ email: email.toLowerCase(), limit: 5 });

    let active = false;
    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) { active = true; break; }

      const trialing = await stripe.subscriptions.list({
        customer: customer.id,
        status: "trialing",
        limit: 1,
      });
      if (trialing.data.length > 0) { active = true; break; }
    }

    res.json({ active });
  } catch (err: any) {
    req.log.error({ err }, "Failed to check subscription status");
    res.status(500).json({ error: "Failed to check subscription" });
  }
});

router.get("/stripe/verify-session", async (req, res) => {
  try {
    const { session_id } = req.query as { session_id?: string };
    if (!session_id) {
      res.status(400).json({ error: "session_id is required" });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const email = session.customer_email || session.customer_details?.email || null;
    const isPaid = session.payment_status === "paid";
    // Trial subscriptions have payment_status "no_payment_required" but are still valid
    const isSubscription = session.mode === "subscription" && !!session.subscription;

    if (isPaid || isSubscription) {
      res.json({ paid: true, email });
    } else {
      res.json({ paid: false });
    }
  } catch (err: any) {
    req.log.error({ err }, "Failed to verify session");
    res.status(400).json({ error: "Invalid session" });
  }
});

export default router;

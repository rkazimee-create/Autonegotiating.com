import { Router, type IRouter } from "express";
import { stripeStorage } from "../lib/stripeStorage";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripeClient";

const router: IRouter = Router();

router.get("/stripe/config", async (req, res) => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
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
    });

    res.json({ url: session.url });
  } catch (err: any) {
    req.log.error({ err }, "Failed to create checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
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

router.get("/stripe/verify-session", async (req, res) => {
  try {
    const { session_id } = req.query as { session_id?: string };
    if (!session_id) {
      res.status(400).json({ error: "session_id is required" });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {
      res.json({ paid: true, email: session.customer_email });
    } else {
      res.json({ paid: false });
    }
  } catch (err: any) {
    req.log.error({ err }, "Failed to verify session");
    res.status(400).json({ error: "Invalid session" });
  }
});

export default router;

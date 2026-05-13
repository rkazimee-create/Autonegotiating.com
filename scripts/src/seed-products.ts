import Stripe from "stripe";

async function getStripeClient(): Promise<Stripe> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. Ensure the Stripe integration is connected.",
    );
  }

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", "development");

  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });

  const data = await resp.json();
  const secretKey = data.items?.[0]?.settings?.secret;
  if (!secretKey) throw new Error("Stripe secret key not found in connection");

  return new Stripe(secretKey, { apiVersion: "2025-08-27.basil" as any });
}

async function createProducts() {
  try {
    const stripe = await getStripeClient();
    console.log("Connected to Stripe. Creating products...");

    // Check if Deal Intelligence Report already exists
    const existing = await stripe.products.search({
      query: "name:'Deal Intelligence Report' AND active:'true'",
    });

    if (existing.data.length > 0) {
      const prod = existing.data[0];
      console.log(`Product already exists: ${prod.name} (${prod.id})`);
      const prices = await stripe.prices.list({ product: prod.id, active: true });
      prices.data.forEach((p) =>
        console.log(
          `  Price: $${((p.unit_amount ?? 0) / 100).toFixed(2)} — ${p.id}`,
        ),
      );
      return;
    }

    // Create the one-time report product
    const product = await stripe.products.create({
      name: "Deal Intelligence Report",
      description:
        "AI-powered car deal analysis with negotiation strategy, market comparables, and a downloadable PDF report.",
      metadata: {
        type: "report",
        feature: "deal_intelligence",
      },
    });
    console.log(`Created product: ${product.name} (${product.id})`);

    // $9.99 one-time price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999,
      currency: "usd",
    });
    console.log(`Created price: $9.99 one-time — ${price.id}`);

    console.log("\n✅ Done! Price ID to use in frontend:", price.id);
  } catch (err: any) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

createProducts();

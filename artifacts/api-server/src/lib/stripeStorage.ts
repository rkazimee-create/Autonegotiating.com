import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export class StripeStorage {
  async getProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`,
    );
    return result.rows[0] ?? null;
  }

  async listProducts(active = true) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active} ORDER BY created DESC`,
    );
    return result.rows;
  }

  async listProductsWithPrices(active = true) {
    const result = await db.execute(
      sql`
        WITH paginated_products AS (
          SELECT id, name, description, metadata, active
          FROM stripe.products
          WHERE active = ${active}
          ORDER BY created DESC
        )
        SELECT
          p.id        AS product_id,
          p.name      AS product_name,
          p.description AS product_description,
          p.active    AS product_active,
          p.metadata  AS product_metadata,
          pr.id       AS price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active   AS price_active,
          pr.metadata AS price_metadata,
          pr.type     AS price_type
        FROM paginated_products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        ORDER BY p.created DESC, pr.unit_amount
      `,
    );
    return result.rows;
  }

  async getPrice(priceId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE id = ${priceId}`,
    );
    return result.rows[0] ?? null;
  }

  async getActiveOneTimePriceForProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE product = ${productId} AND active = true AND type = 'one_time' LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }

  async getCustomerByEmail(email: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.customers WHERE email = ${email} AND deleted = false LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }

  async checkPaymentIntentPaid(customerId: string, priceId: string) {
    const result = await db.execute(
      sql`
        SELECT pi.id FROM stripe.payment_intents pi
        WHERE pi.customer = ${customerId}
          AND pi.status = 'succeeded'
          AND pi.metadata->>'price_id' = ${priceId}
        LIMIT 1
      `,
    );
    return result.rows.length > 0;
  }

  async checkSessionCompleted(sessionId: string) {
    const result = await db.execute(
      sql`SELECT id, payment_status FROM stripe.checkout_sessions WHERE id = ${sessionId} LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }
}

export const stripeStorage = new StripeStorage();

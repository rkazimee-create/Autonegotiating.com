import { pgTable, text, serial, integer, timestamp, date, index, unique } from "drizzle-orm/pg-core";

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id:         serial("id").primaryKey(),
    vin:        text("vin").notNull(),
    price:      integer("price").notNull(),
    priceDate:  date("price_date").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("price_snapshots_vin_date").on(table.vin, table.priceDate),
    index("ps_vin_idx").on(table.vin),
  ],
);

export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type InsertPriceSnapshot = typeof priceSnapshots.$inferInsert;

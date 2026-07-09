import { pgTable, text, serial, integer, timestamp, date, index, unique, jsonb, boolean } from "drizzle-orm/pg-core";

// ── Users (synced from Clerk) ────────────────────────────────────────────────
export const users = pgTable("users", {
  id:        serial("id").primaryKey(),
  clerkId:   text("clerk_id").notNull().unique(),
  email:     text("email").notNull(),
  name:      text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("users_clerk_id_idx").on(t.clerkId)]);

export type User = typeof users.$inferSelect;

// ── Buyer profiles ───────────────────────────────────────────────────────────
export const buyerProfiles = pgTable("buyer_profiles", {
  id:        serial("id").primaryKey(),
  clerkId:   text("clerk_id").notNull().unique(),
  name:      text("name"),
  email:     text("email"),
  phone:     text("phone"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BuyerProfile = typeof buyerProfiles.$inferSelect;

// ── Saved searches ───────────────────────────────────────────────────────────
export const savedSearches = pgTable("saved_searches", {
  id:        serial("id").primaryKey(),
  clerkId:   text("clerk_id").notNull(),
  make:      text("make"),
  model:     text("model"),
  trim:      text("trim"),
  condition: text("condition"),
  zip:       text("zip"),
  radius:    text("radius"),
  body:      text("body"),
  label:     text("label").notNull(),
  imgs:      jsonb("imgs").default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("saved_searches_clerk_id_idx").on(t.clerkId)]);

export type SavedSearch = typeof savedSearches.$inferSelect;

// ── Saved listings (favorites) ───────────────────────────────────────────────
export const savedListings = pgTable("saved_listings", {
  id:          serial("id").primaryKey(),
  clerkId:     text("clerk_id").notNull(),
  vin:         text("vin").notNull(),
  listingData: jsonb("listing_data").notNull(),
  savedAt:     timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("saved_listings_clerk_id_idx").on(t.clerkId),
  unique("saved_listings_clerk_vin").on(t.clerkId, t.vin),
]);

export type SavedListing = typeof savedListings.$inferSelect;

// ── Offer history ────────────────────────────────────────────────────────────
export const offerHistory = pgTable("offer_history", {
  id:          serial("id").primaryKey(),
  clerkId:     text("clerk_id").notNull(),
  vin:         text("vin"),
  dealerName:  text("dealer_name"),
  dealerEmail: text("dealer_email"),
  subject:     text("subject"),
  body:        text("body"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("offer_history_clerk_id_idx").on(t.clerkId)]);

export type OfferHistory = typeof offerHistory.$inferSelect;

// ── Offer threads ─────────────────────────────────────────────────────────────
// Each buyer offer creates a thread with a unique reply-to alias. Dealer replies
// land on that alias (via inbound email webhook) and are relayed to the buyer's
// real email, so the buyer's real address is never exposed to the dealer.
export const offerThreads = pgTable("offer_threads", {
  id:          serial("id").primaryKey(),
  clerkId:     text("clerk_id").notNull(),
  vin:         text("vin"),
  dealerName:  text("dealer_name"),
  dealerEmail: text("dealer_email").notNull(),
  buyerEmail:  text("buyer_email").notNull(),
  buyerName:   text("buyer_name"),
  anonymous:   boolean("anonymous").default(false).notNull(),
  replyAlias:  text("reply_alias").notNull().unique(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("offer_threads_clerk_id_idx").on(t.clerkId),
  index("offer_threads_reply_alias_idx").on(t.replyAlias),
]);

export type OfferThread = typeof offerThreads.$inferSelect;

// ── Offer messages ────────────────────────────────────────────────────────────
// Log of every message in a thread, in both directions, for the buyer's record
// and for debugging delivery issues.
export const offerMessages = pgTable("offer_messages", {
  id:         serial("id").primaryKey(),
  threadId:   integer("thread_id").notNull().references(() => offerThreads.id, { onDelete: "cascade" }),
  direction:  text("direction").notNull(), // "outbound" (buyer→dealer) | "inbound" (dealer→buyer)
  fromEmail:  text("from_email").notNull(),
  toEmail:    text("to_email").notNull(),
  subject:    text("subject"),
  body:       text("body").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("offer_messages_thread_id_idx").on(t.threadId)]);

export type OfferMessage = typeof offerMessages.$inferSelect;

// ── Price snapshots ──────────────────────────────────────────────────────────
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

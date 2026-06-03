import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, users, buyerProfiles, savedSearches, savedListings, offerHistory } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

// Helper — get clerkId from request, return 401 if not authenticated
function requireAuth(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

// Wrap async route handlers so errors are forwarded to Express error handler with details
function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Upsert user record from Clerk session
async function syncUser(clerkId: string, email: string, name?: string) {
  await db
    .insert(users)
    .values({ clerkId, email: email ?? "", name })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: email ?? "", name, updatedAt: new Date() },
    });
}

// ── Me ───────────────────────────────────────────────────────────────────────
router.get("/user/me", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const [profile] = await db
    .select()
    .from(buyerProfiles)
    .where(eq(buyerProfiles.clerkId, clerkId))
    .limit(1);

  res.json({ clerkId, profile: profile ?? null });
}));

// ── Buyer profile ─────────────────────────────────────────────────────────────
router.get("/user/profile", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const [profile] = await db
    .select()
    .from(buyerProfiles)
    .where(eq(buyerProfiles.clerkId, clerkId))
    .limit(1);

  res.json(profile ?? {});
}));

router.put("/user/profile", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const { name, email, phone } = req.body as { name?: string; email?: string; phone?: string };

  const [profile] = await db
    .insert(buyerProfiles)
    .values({ clerkId, name, email, phone })
    .onConflictDoUpdate({
      target: buyerProfiles.clerkId,
      set: { name, email, phone, updatedAt: new Date() },
    })
    .returning();

  res.json(profile);
}));

// ── Saved searches ────────────────────────────────────────────────────────────
router.get("/user/searches", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.clerkId, clerkId))
    .orderBy(desc(savedSearches.createdAt))
    .limit(6);

  res.json(rows);
}));

router.post("/user/searches", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const { make, model, trim, condition, zip, radius, body, label, imgs, email, name } =
    req.body as {
      make?: string; model?: string; trim?: string; condition?: string;
      zip?: string; radius?: string; body?: string; label: string;
      imgs?: string[]; email?: string; name?: string;
    };

  if (!label) { res.status(400).json({ error: "label required" }); return; }

  // Sync user record
  if (email) await syncUser(clerkId, email, name);

  // Get current list, filter out duplicate label, trim to 5 before inserting new
  const existing = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.clerkId, clerkId))
    .orderBy(desc(savedSearches.createdAt));

  // Delete rows with the same label (dedup)
  for (const row of existing.filter((r: typeof existing[0]) => r.label === label)) {
    await db.delete(savedSearches).where(eq(savedSearches.id, row.id));
  }

  // Keep only 5 so there's room for the new entry (max 6 total)
  const deduped = existing.filter((r: typeof existing[0]) => r.label !== label);
  for (const row of deduped.slice(5)) {
    await db.delete(savedSearches).where(eq(savedSearches.id, row.id));
  }

  const [inserted] = await db
    .insert(savedSearches)
    .values({ clerkId, make, model, trim, condition, zip, radius, body, label, imgs: imgs ?? [] })
    .returning();

  res.json(inserted);
}));

router.patch("/user/searches/:id/images", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const { imgs } = req.body as { imgs: string[] };
  const id = Number(req.params.id);

  const [updated] = await db
    .update(savedSearches)
    .set({ imgs })
    .where(eq(savedSearches.id, id))
    .returning();

  res.json(updated ?? {});
}));

router.delete("/user/searches/:id", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  await db
    .delete(savedSearches)
    .where(eq(savedSearches.id, Number(req.params.id)));

  res.json({ success: true });
}));

// ── Saved listings (favorites) ────────────────────────────────────────────────
router.get("/user/favorites", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const rows = await db
    .select()
    .from(savedListings)
    .where(eq(savedListings.clerkId, clerkId))
    .orderBy(desc(savedListings.savedAt));

  res.json(rows);
}));

router.post("/user/favorites", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const { vin, listingData } = req.body as { vin: string; listingData: object };
  if (!vin) { res.status(400).json({ error: "vin required" }); return; }

  const [row] = await db
    .insert(savedListings)
    .values({ clerkId, vin, listingData })
    .onConflictDoUpdate({
      target: [savedListings.clerkId, savedListings.vin],
      set: { listingData, savedAt: new Date() },
    })
    .returning();

  res.json(row);
}));

router.delete("/user/favorites/:vin", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  await db
    .delete(savedListings)
    .where(eq(savedListings.vin, req.params.vin));

  res.json({ success: true });
}));

// ── Offer history ──────────────────────────────────────────────────────────────
router.get("/user/offers", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const rows = await db
    .select()
    .from(offerHistory)
    .where(eq(offerHistory.clerkId, clerkId))
    .orderBy(desc(offerHistory.submittedAt));

  res.json(rows);
}));

router.post("/user/offers", wrap(async (req, res) => {
  const clerkId = requireAuth(req, res);
  if (!clerkId) return;

  const { vin, dealerName, dealerEmail, subject, body } = req.body as {
    vin?: string; dealerName?: string; dealerEmail?: string;
    subject?: string; body?: string;
  };

  const [row] = await db
    .insert(offerHistory)
    .values({ clerkId, vin, dealerName, dealerEmail, subject, body })
    .returning();

  res.json(row);
}));

export default router;

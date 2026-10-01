# SEO read safety and VIN resilience — 2026-10-01

## Status

Implementation and local validation pass. **Production validation is BLOCKED,
not PASS:** the published application has not attested to the reviewed build.
The production smoke invocation made one read-only health request, zero SEO/VIN
requests, and exited 2 after 0.26 seconds. Its live health response redirected;
the new build mounts public health before authentication to prevent that.

Publishing is user-initiated in Replit. Republish the reviewed build, then run
`pnpm smoke:production`. The runner must observe the exact audited build stamp
before requesting any sitemap, SEO page, or VIN document.

## Architectural changes

### Public reads and maintenance

Inventory query helpers now compute freshness without calling maintenance.
Public sitemaps, shards, directory pages, Phase 2 families, Phase 3A national
entities, Phase 3B years, and VIN GET/HEAD requests only read inventory.

Stale deactivation still uses the existing freshness window and existing
15-minute throttle. It runs at the start of successful upstream inventory
ingestion, before the existing upsert bookkeeping. There is no newly added
startup timer or read-triggered maintenance.

Stale records are excluded immediately by the same active/last_seen predicates,
even when no ingestion has yet run to persist their inactive status.
Deactivation notifications therefore wait for the next successful ingestion
instead of being triggered by crawler traffic. This lifecycle choice is
intentional; it does not alter qualification or the freshness window.

IndexNow remains downstream of genuine new/material/reactivated inventory and
stale deactivation, using the existing deduplication, phase thresholds, and
best-effort bookkeeping. Public reads do not enqueue or submit notifications.
Existing live search/vehicle API endpoints remain available separately.

### VIN SSR

`/vehicle/:vin` validates the VIN and preserves the uppercase 301 canonical
redirect. The lookup selects only qualifying persisted active/fresh inventory,
then renders the existing vehicle template from those fields. No live Auto.dev
lookup or five-minute upstream cache is involved.

- Qualifying persisted row: useful SSR 200, regardless of Auto.dev health/quota.
- Unknown, inactive, stale, or invalid VIN: deterministic 404.
- Noncanonical casing: permanent uppercase redirect before lookup.
- HEAD: the same persisted-only lookup, with no response body or upstream call.
- Database failure: 503; upstream API failures cannot reach this read path.
- Missing image/source URL/condition/price/mileage/dealer: omit unsupported
  structured fields or display an explicit unknown; never fabricate them.
- Vehicle/Product/Offer JSON-LD retains supported persisted identity and facts.
- Auto.dev source links are not mislabeled as original dealer links.

### September quota-failure VIN

A fresh read-only production SELECT confirmed
`1GYTEDKL5SU107838`: active 2025 Cadillac Escalade IQ Luxury 2, new,
price $151,015, mileage 4, dealer/location available, no source URL, last_seen
2026-09-17 02:08:45.194 UTC. It qualifies under the existing 30-day window on
2026-10-01.

A regression fixture using those production-observed public inventory fields
renders useful SSR 200 through the real VIN router, asserting vehicle identity,
price, mileage, dealer/location, and zero fetch/Auto.dev requests. The clock is
fixed to the observation date so this historical regression remains stable.
No database was seeded. This is a local reproduction using production-observed
data, **not a fresh production VIN HTTP result**.

The development preview has no qualifying row for this VIN and correctly
renders its 404 page. Development and production inventory must not be conflated.

### SearchAction

Removed the invalid homepage SearchAction object rather than replacing it with
another template. The existing WebSite and Organization JSON-LD remain intact.
Search found no current web/API source or web build emitting the obsolete
literal; the smoke tests retain that literal intentionally as a detector.

### Smoke safety and coverage

Build and smoke code compute the same SHA-256 over the API's transitive local
runtime/startup source trees, shared runtime sources, package manifests, lockfile,
and build configuration. New runtime modules invalidate source approval.

The allowlisted snapshot was independently reviewed. Public `/api/healthz`
returns its compiled stamp and no-store caching before authentication. The
runner accepts only an exact live match; missing, mismatched, or redirecting
responses stop before SEO/VIN reads.

After attestation, the existing checks cover sitemap discovery/XML/duplicates,
static routes, advertised Phase 2/3A/3B routes, SSR, canonicals, JSON-LD, hierarchy,
pagination, legacy redirects, and negative routes. VIN sampling is the target
plus at most four deterministic sitemap VINs, with target HEAD and bounded
unknown/invalid/casing diagnostics. GET/HEAD cannot consume Auto.dev quota.

Limits remain 80 requests, 120 seconds, 20 sitemaps, 60 non-VIN SEO pages, with
per-request timeout/response limits and manual redirect handling.

## Validation

- Original 56 SEO/IndexNow regressions: pass.
- New VIN/read-safety regressions: 15 pass, including nested cases.
- Node regression total: 71 pass, zero failed.
- Original 36 offline smoke fixtures plus 4 new fixtures: 40 pass, zero failed.
- Combined total: **111 passing tests** (previously 92).
- API TypeScript checks and production build: pass.
- Shared TypeScript project checks: pass.
- Web production build: pass.
- Independent source/security review and diff whitespace check: pass.
- API/web workflows restarted and serving.
- VIN preview checked without invoking live inventory searches.

Tests use synthetic/in-memory DB results, guarded external network boundaries,
fake IndexNow fetchers, and a dummy DB URL. No production writes, seeding, bulk
Auto.dev searches, manual IndexNow submissions, or bootstrap execution occurred.

## Current production smoke result

| Measure | Result |
|---|---|
| Overall | BLOCKED — live build safety unverified |
| Exit | 2 |
| Requests | 1 (health only) |
| SEO/VIN checks | 0 |
| Runtime | 0.26 seconds |
| Warnings / check failures | 0 / 0 (checks did not run) |
| Safety blockers | 1 |
| Static / Phase 2 / Phase 3A / Phase 3B / VIN sitemap counts | UNKNOWN |
| Fresh production target VIN SSR 200 verification | Pending republish |

Unknown counts are not zero and are not database-derived sitemap estimates.

## Files changed

- `artifacts/api-server/src/lib/inventory-index.ts`
- `artifacts/api-server/src/lib/persisted-vehicle-page.ts` (new)
- `artifacts/api-server/src/lib/vehicle-page.ts`
- `artifacts/api-server/src/routes/vehicle-page.ts`
- `artifacts/api-server/src/routes/health.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/persisted-vehicle-page.test.ts` (new)
- `artifacts/api-server/src/seo-read-safety.test.ts` (new)
- `artifacts/api-server/build.mjs`
- `artifacts/api-server/package.json`
- `artifacts/autonegotiating/index.html`
- `scripts/production_seo_smoke.py`
- `scripts/test_production_seo_smoke.py`
- `scripts/seo-read-safety-sources.json` (new)
- This report and the existing inventory audit-safety memory note.

No schema changes, state pages, new SEO page types, Phase 4 work, or deployment
configuration changes were introduced. Stop for publishing/review.
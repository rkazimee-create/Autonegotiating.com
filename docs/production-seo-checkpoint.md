# Production SEO checkpoint — October 1, 2026

## Scope and safety

This is an investigation and test-tooling change only. No application routes,
renderers, database schema, inventory rows, or IndexNow implementation were changed.
No deployment, inventory seed, IndexNow submission/bootstrap, or Auto.dev search
was performed.

Production public HTTP requests made during this investigation: **0**.
Five read-only production SQL queries, deployment metadata, and existing deployment
logs supplied the production evidence. These are not website HTTP probes.

**Overall production validation: BLOCKED / not a PASS.** Current sitemap and
inventory-page GET/HEAD handlers cannot be assumed read-only. Their qualified
inventory query helpers call stale-refresh bookkeeping. That bookkeeping may
execute a database UPDATE, deactivate stale inventory, and queue IndexNow.
Its per-process 15-minute interval does not establish a safe testing window:
autoscaling, restarts, and concurrent activity make that unreliable.
Even an UPDATE affecting zero rows is not a read-only operation.

The smoke command fails closed before issuing any HTTP request when its source
safety preflight detects this coupling or cannot establish the expected query
implementation. Changing the base URL does not bypass the guard.
No app behavior was changed to make the test pass.

## VIN failure diagnosis

Target: `https://www.autonegotiating.com/vehicle/1GYTEDKL5SU107838`.

### Data source and status branches

`artifacts/api-server/src/routes/vehicle-page.ts` renders from an Auto.dev
listing response, not from `active_inventory`. It uses a process-local
`vehicle-page:{VIN}` cache with a five-minute TTL.

- Invalid VIN (not a 17-character VIN excluding I/O/Q): **404**, no lookup.
- Valid but noncanonical case/whitespace: **301** to the uppercase VIN URL,
  before lookup.
- Canonical valid VIN: cache hit avoids upstream; a miss calls the legacy
  Auto.dev `/api/listings` endpoint filtered by VIN, page 1, limit 1.
- A matching VIN whose `active` value is not explicitly false: **200**.
- Successful lookup without a matching available VIN: **404**.
- Any caught lookup/cache/extraction/render error: **503**, `Retry-After: 60`,
  with a noindex/nofollow temporary-error page.
- There is no explicit **429** public VIN branch. Auto.dev's 429, other upstream
  HTTP errors, missing key, transport timeout, and invalid JSON all reach the
  503 catch. Failures outside this handler/platform errors can produce other
  5xx responses, but this handler does not deliberately return them.

HEAD is not a quota-free alternative: Express falls through to the GET handler
when no dedicated HEAD handler exists. It can execute the same upstream request.
Cache expiry, a new server instance, or restart can therefore make any valid VIN
request depend on Auto.dev. Failed lookups have no persisted/stale fallback.

### Direct historical production evidence

Existing logs from **2026-09-21 at 18:43:02 UTC** show this exact VIN failing twice:

1. Auto.dev returns **429** with `RATE_LIMIT_EXCEEDED` and the explicit
   **monthly quota of 1,000 requests exceeded** message.
2. The public `/vehicle/1GYTEDKL5SU107838` request returns **503**.

Thus the quota explanation is directly supported for the September 21 failures,
not merely inferred from nearby inventory-search failures. The September 18
Search Console failure is consistent with the same mechanism, but its exact
cause is not independently established by this evidence.

The most recent target-VIN response found in the October 1 logs is **200** at
**02:28:57.471 UTC**. This is an observed existing response, not a fresh probe.
Its HTTP status at the moment of this checkpoint remains unverified because
another GET/HEAD could consume live Auto.dev quota.

### Persisted production record

Read-only SQL at **2026-10-01 21:23:48 UTC** found:

- VIN exists and `active = true`.
- Vehicle: **2025 Cadillac Escalade IQ Luxury 2**, new.
- Asking price: **$151,015**; mileage: **4**.
- Dealer: **Kendall Cadillac of Eugene**, Eugene, Oregon.
- `last_seen`: **2026-09-17 02:08:45.194 UTC** (about **14.8 days** old).
- Valid VIN and nonempty make/model; fresh within the default **30-day** window.
- No `INVENTORY_FRESHNESS_DAYS` override was returned by production environment
  configuration inspection.
- No persisted source URL for this record. The schema also does not store photos.

The row qualifies for the vehicle sitemap according to the current query
predicate. **Actual live sitemap advertisement was not fetched or verified.**
There is enough persisted data for useful, factual SSR HTML and basic
Vehicle/Product/Offer information without a successful live API request.
A redesign need not fabricate unavailable images or dealer-origin URLs.

**Recommendation, not implemented:** make fresh qualifying persisted inventory
the primary VIN SSR source (or a deliberate persisted fallback), define clear
stale/inactive/absent behavior, and avoid ordinary crawler-driven live lookups.
Do not refresh `last_seen` from crawler traffic.

## Obsolete literal root query template

The literal still exists in
`artifacts/autonegotiating/index.html:37`, in the WebSite JSON-LD
SearchAction target:

`https://www.autonegotiating.com/?make={make}&model={model}`

Therefore current homepage HTML can still emit it. No matching sitemap entry
or separate encoded literal was found in the searched source. Vehicle
breadcrumbs and a PDF output link generate root make/model queries with actual
values through `URLSearchParams`; these are distinct from the unexpanded
placeholder. No template or link was changed.

**Recommendation, not implemented:** remove or replace the obsolete SearchAction
with an actually supported search contract; do not advertise placeholder URLs
as crawlable destinations.

## Production inventory snapshot versus sitemap verification

Production SQL found **862** inventory records, all active and qualified under
the 30-day window; zero active records were older than that cutoff.
This does not make a public sitemap request read-only: its handler still
attempts stale-refresh writes when eligible.

The following are **database-derived expectations**, not observed sitemap counts:

| Page type | Expected eligible count | Live sitemap verification |
| --- | ---: | --- |
| Static | 4 from source | Blocked |
| Phase 2 model family | 4 | Blocked |
| Phase 3A national shopper entity | 5 | Blocked |
| Phase 3B year/entity | 28 | Blocked |
| Vehicle | 862 | Blocked |

Phase 2 groups: BMW 5 Series (175), BMW 8 Series (208), BMW X7 (243),
Cadillac Escalade IQ (236). Phase 3A qualifying entities: 530i (59), 540i (38),
840i (62), M550i (28), M850i (55). M340i currently has no qualifying group.
These expectations use the current exact BMW family/trim mapping and thresholds
(national 2, year 3), not historical counts.

Phase 3B qualifying counts by entity: 530i **7 years**, 540i **7**, 840i **6**,
M550i **3**, M850i **5**; **28 total**. The set now includes 2025 540i, unlike
the earlier 27-year snapshot.

HTTP metadata, SSR content, JSON-LD, backlinks, national/year sitemap agreement,
legacy alias redirects, invalid third-segment 404s, and live pagination were
**not verified against production**. The bounded fixture suite exercises these
validators without contacting the live site.

## Review boundary

No recommended fixes have been implemented. Before a complete production smoke
run is safe, review and approve decoupling stale deactivation and IndexNow
notification from public sitemap/directory reads. Then validate and publish that
separate behavior change, inspect the deployed route contract, and rerun the smoke
command. Source inspection alone is not proof that a different deployed revision
has the same behavior.

## Commands, scope, and validation

Future production command:

```sh
pnpm smoke:production
# Alternate canonical origin (does not bypass source safety review):
SEO_SMOKE_BASE_URL=https://example.com pnpm smoke:production
# Isolated, transport-free regression fixtures:
pnpm test:production-seo-smoke
```

The suite uses Python 3 standard-library HTTP, XML, and HTML parsing; no browser,
third-party package, API credential, or database connection is needed.
It discovers child sitemaps from the index, checks canonical origins, duplicates,
classification and aliases, and validates all discovered non-VIN pages within
hard budgets: **60 pages, 20 sitemaps, 80 HTTP requests, 120 seconds**.
Exceeding a budget is a nonzero failure, not silently truncated coverage.
VIN URLs are checked structurally but never fetched. Only allowlisted public
paths on the configured origin can be requested; redirects are manual and bounded.
An explicitly reviewed source-fingerprint allowlist is intentionally empty:
future source changes cannot automatically approve themselves as read-only.
Deployed behavior must be reviewed too before approving a snapshot.

Production invocation completed its preflight in **0.01 seconds**, with **0 HTTP
requests, 0 live checks**, and **exit 2 / BLOCKED**. Actual sitemap/category counts
remain UNKNOWN. A safe complete run exits 0 only if its material checks pass;
material validator failures exit 1.

Validation completed:

- **36/36 offline smoke fixtures passed**, including integrated false-PASS
  regressions and confirmation that the current guard stops before transport.
  Fixture test runtime: **0.115 seconds**.
- API TypeScript check passed.
- API production build passed.
- **56/56 existing Phase 2/3A/3B/IndexNow regression tests passed**; IndexNow calls
  used fake fetchers, not the external service. Test subprocesses had Auto.dev and
  IndexNow credentials removed and a non-production dummy database target.
- Web production build passed with `PORT=5173`; an initial attempt without PORT
  was rejected by the existing Vite configuration, not by these changes.
- `git diff --check` passed.

Files created/changed:

- `package.json`: production smoke and offline fixture commands.
- `scripts/production_seo_smoke.py`: bounded validators, transport and safety guard.
- `scripts/test_production_seo_smoke.py`: offline fixtures.
- `docs/production-seo-checkpoint.md`: this report.
- `.agents/memory/active-inventory-indexing.md`: durable audit safety boundary.

The supplied attachment remains user-provided input, not an implementation file.
No application runtime file changed. Full production PASS/FAIL cannot be
determined safely until the write-on-read dependency is separately reviewed
and addressed.
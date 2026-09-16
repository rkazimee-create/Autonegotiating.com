import { Router, type IRouter } from "express";
import {
  qualifiedInventoryCount,
  qualifiedInventoryGroups,
  qualifiedInventoryPage,
  qualifiedVehicleShard,
} from "../lib/inventory-index";

const router: IRouter = Router();
const ORIGIN = "https://www.autonegotiating.com";
const SHARD_SIZE = 49_000;
const CARS_PAGE_SIZE = 100;
const MAX_PAGE = 10_000;

type InventoryGroup = Awaited<ReturnType<typeof qualifiedInventoryGroups>>[number];
type SluggedInventoryGroup = InventoryGroup & {
  makeSlug: string;
  modelSlug: string;
  baseMakeSlug: string;
  baseModelSlug: string;
};

function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function xmlDocument(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${content}`;
}

const STATIC_URLS = [
  { path: "/", lastmod: "2026-07-02", changefreq: "daily", priority: "1.0" },
  { path: "/deal-intelligence.html", lastmod: "2026-07-02", changefreq: "weekly", priority: "0.8" },
  { path: "/trade-intelligence.html", lastmod: "2026-07-02", changefreq: "weekly", priority: "0.8" },
  { path: "/cars", lastmod: "2026-07-02", changefreq: "daily", priority: "0.8" },
];

function renderStaticSitemap(): string {
  const urls = STATIC_URLS.map((item) => `<url><loc>${escapeXml(`${ORIGIN}${item.path}`)}</loc>` +
    `<lastmod>${item.lastmod}</lastmod><changefreq>${item.changefreq}</changefreq>` +
    `<priority>${item.priority}</priority></url>`).join("");
  return xmlDocument(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}

router.get("/sitemap-static.xml", (_req, res) => {
  res.type("application/xml").send(renderStaticSitemap());
});

router.get("/sitemap.xml", async (req, res): Promise<void> => {
  try {
    const count = await qualifiedInventoryCount();
    const shardCount = Math.ceil(count / SHARD_SIZE);
    const entries = [
      `<sitemap><loc>${ORIGIN}/sitemap-static.xml</loc></sitemap>`,
      ...Array.from({ length: shardCount }, (_, index) =>
        `<sitemap><loc>${ORIGIN}/sitemap-vehicles/${index + 1}.xml</loc></sitemap>`,
      ),
    ].join("");
    res.type("application/xml").send(xmlDocument(
      `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`,
    ));
  } catch (err) {
    req.log.error({ err }, "sitemap index generation failed");
    res.status(503).type("text").send("Sitemap temporarily unavailable");
  }
});

router.get("/sitemap-vehicles/:shard.xml", async (req, res): Promise<void> => {
  const shard = Number(req.params.shard);
  if (!Number.isInteger(shard) || shard < 1) {
    res.status(404).type("text").send("Sitemap shard not found");
    return;
  }
  try {
    const count = await qualifiedInventoryCount();
    const offset = (shard - 1) * SHARD_SIZE;
    if (offset >= count) {
      res.status(404).type("text").send("Sitemap shard not found");
      return;
    }
    const vehicles = await qualifiedVehicleShard(offset, SHARD_SIZE);
    const urls = vehicles.map((vehicle) => `<url><loc>${
      escapeXml(`${ORIGIN}/vehicle/${encodeURIComponent(vehicle.vin)}`)
    }</loc><lastmod>${escapeXml(vehicle.updatedAt.toISOString().slice(0, 10))}</lastmod></url>`).join("");
    res.type("application/xml").send(xmlDocument(
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    ));
  } catch (err) {
    req.log.error({ err, shard }, "vehicle sitemap generation failed");
    res.status(503).type("text").send("Sitemap temporarily unavailable");
  }
});

function pageNumber(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PAGE ? parsed : null;
}

function directorySlug(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableSlugSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sluggedInventoryGroups(groups: InventoryGroup[]): SluggedInventoryGroup[] {
  const prepared = groups.map((group) => ({
    ...group,
    baseMakeSlug: directorySlug(group.make),
    baseModelSlug: directorySlug(group.model),
  }));
  const pathCounts = new Map<string, number>();
  for (const group of prepared) {
    const key = `${group.baseMakeSlug}/${group.baseModelSlug}`;
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
  }
  return prepared.map((group) => {
    const key = `${group.baseMakeSlug}/${group.baseModelSlug}`;
    const suffix = pathCounts.get(key) === 1
      ? ""
      : `-${stableSlugSuffix(`${group.make}\0${group.model}`)}`;
    return {
      ...group,
      makeSlug: group.baseMakeSlug,
      modelSlug: `${group.baseModelSlug}${suffix}`,
    };
  });
}

function shell(title: string, description: string, canonical: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}"><style>
body{font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a18;background:#fafaf7;margin:0}
header{background:#fff;border-bottom:1px solid #e8e8e2;padding:18px 24px}header a{color:#1a1a18;text-decoration:none;font-weight:700;font-size:22px}
main{max-width:1000px;margin:auto;padding:32px 24px 60px}h1,h2,h3{font-family:Georgia,serif}h1{font-size:40px}
section{background:#fff;border:1px solid #e8e8e2;border-radius:10px;padding:16px 20px;margin:16px 0}
ul{padding-left:20px}a{color:#a34a12}li{margin:6px 0}small{color:#777}
</style></head><body><header><a href="${ORIGIN}/">AutoNegotiating.com</a></header><main>${body}</main></body></html>`;
}

router.get("/cars", async (req, res): Promise<void> => {
  try {
    const groups = sluggedInventoryGroups(await qualifiedInventoryGroups());
    const content = groups.map((group) => {
      const href = `/cars/${group.makeSlug}/${group.modelSlug}`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(`${group.make} ${group.model}`)}</a> ` +
        `<small>(${group.count} vehicle${group.count === 1 ? "" : "s"})</small></li>`;
    }).join("");
    res.type("html").send(shell("Active Cars for Sale | AutoNegotiating.com",
      "Browse active vehicle listings by make and model.",
      `${ORIGIN}/cars`,
      `<nav><a href="${ORIGIN}/">Home</a></nav><h1>Active cars for sale</h1>` +
      `<p>Browse currently indexed vehicle listings by make and model.</p><ul>${content || "<li>No active vehicle listings are currently indexed.</li>"}</ul>`));
  } catch (err) {
    req.log.error({ err }, "cars directory generation failed");
    res.status(503).type("text").send("Inventory directory temporarily unavailable");
  }
});

router.get("/cars/:make/:model", async (req, res): Promise<void> => {
  const page = pageNumber(req.query.page);
  if (!page) {
    res.status(400).type("text").send("Invalid page");
    return;
  }
  const requestedMake = String(req.params.make || "").trim();
  const requestedModel = String(req.params.model || "").trim();
  if (!requestedMake || !requestedModel) {
    res.status(404).type("text").send("Inventory directory page not found");
    return;
  }
  try {
    const groups = sluggedInventoryGroups(await qualifiedInventoryGroups());
    const requestedMakeSlug = directorySlug(requestedMake);
    const requestedModelSlug = directorySlug(requestedModel);
    const directMatch = groups.find((group) =>
      group.makeSlug === requestedMakeSlug && group.modelSlug === requestedModelSlug
    );
    const legacyMatches = groups.filter((group) =>
      group.baseMakeSlug === requestedMakeSlug && group.baseModelSlug === requestedModelSlug
    );
    const group = directMatch ?? (legacyMatches.length === 1 ? legacyMatches[0] : undefined);
    if (!group) {
      res.status(404).type("text").send("Inventory directory page not found");
      return;
    }
    const base = `/cars/${group.makeSlug}/${group.modelSlug}`;
    if (req.path !== base) {
      res.redirect(308, `${base}${page > 1 ? `?page=${page}` : ""}`);
      return;
    }
    const offset = (page - 1) * CARS_PAGE_SIZE;
    const vehicles = await qualifiedInventoryPage(group.make, group.model, offset, CARS_PAGE_SIZE);
    if (!vehicles.length) {
      res.status(404).type("text").send("Inventory directory page not found");
      return;
    }
    const links = vehicles.map((vehicle) => `<li><a href="${escapeHtml(`${ORIGIN}/vehicle/${encodeURIComponent(vehicle.vin)}`)}">${
      escapeHtml([vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" "))
    }</a>${vehicle.dealerName ? ` <small>${escapeHtml(vehicle.dealerName)}</small>` : ""}</li>`).join("");
    const pagination = [
      page > 1 ? `<a href="${escapeHtml(`${base}?page=${page - 1}`)}">Previous</a>` : "",
      vehicles.length === CARS_PAGE_SIZE ? ` <a href="${escapeHtml(`${base}?page=${page + 1}`)}">Next</a>` : "",
    ].filter(Boolean).join(" · ");
    res.type("html").send(shell(`${group.make} ${group.model} for Sale | AutoNegotiating.com`,
      `Active ${group.make} ${group.model} vehicle listings.`,
      `${ORIGIN}${base}${page > 1 ? `?page=${page}` : ""}`,
      `<nav><a href="${ORIGIN}/cars">All active cars</a></nav><h1>${escapeHtml(`${group.make} ${group.model}`)}</h1>` +
      `<p>Active vehicle listings${page > 1 ? ` · page ${page}` : ""}</p><ul>${links || "<li>No active vehicle listings found.</li>"}</ul>` +
      (pagination ? `<nav aria-label="Pagination">${pagination}</nav>` : "")));
  } catch (err) {
    req.log.error({ err, requestedMake, requestedModel, page }, "vehicle directory page generation failed");
    res.status(503).type("text").send("Inventory directory temporarily unavailable");
  }
});

export default router;
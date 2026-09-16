type Listing = Record<string, unknown>;

const DEFAULT_SITE_ORIGIN = "https://www.autonegotiating.com";
const SITE_ORIGIN = (process.env.PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value: number | null): string {
  return value == null || value <= 0
    ? "Call for price"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
}

function formatMileage(value: number | null): string {
  return value == null || value < 0
    ? "Mileage not provided"
    : `${Math.round(value).toLocaleString("en-US")} miles`;
}

function absoluteHttpUrl(value: unknown): string | null {
  const candidate = text(value);
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}

function firstAbsoluteUrl(listing: Listing, keys: string[]): string | null {
  for (const key of keys) {
    const url = absoluteHttpUrl(listing[key]);
    if (url) return url;
  }
  return null;
}

function sourceListingUrl(listing: Listing): { url: string | null; label: string } {
  const dealerUrl = firstAbsoluteUrl(listing, [
    "clickoffUrl",
    "dealerListingUrl",
    "dealerUrl",
    "dealerWebsite",
    "listingUrl",
    "vdpUrl",
  ]);
  if (dealerUrl) return { url: dealerUrl, label: "View original dealer listing" };

  // auto.dev sometimes returns its VDP as a relative path while omitting
  // clickoffUrl. Keep a useful source link rather than inventing a dealer URL.
  const relativeVdp = text(listing.vdpUrl);
  if (relativeVdp.startsWith("/")) {
    return {
      url: `https://www.auto.dev${relativeVdp}`,
      label: "View source listing",
    };
  }

  return { url: null, label: "Dealer listing link unavailable" };
}

function getPhotoUrl(listing: Listing): string | null {
  const primary = absoluteHttpUrl(listing.primaryPhotoUrl);
  if (primary) return primary;
  const photos = listing.photoUrls;
  if (Array.isArray(photos)) {
    for (const photo of photos) {
      const url = absoluteHttpUrl(photo);
      if (url) return url;
    }
  }
  return null;
}

function getLocation(listing: Listing): { city: string; state: string } {
  return {
    city: text(listing.city),
    state: text(listing.state),
  };
}

function vehicleName(listing: Listing): string {
  const year = text(listing.year);
  const make = text(listing.make);
  const model = text(listing.model);
  const trim = text(listing.trim);
  return [year, make, model, trim].filter(Boolean).join(" ");
}

function getCondition(listing: Listing): { label: string; schema: string } {
  const raw = text(listing.condition).toLowerCase();
  if (raw === "new") {
    return { label: "New", schema: "https://schema.org/NewCondition" };
  }
  if (raw === "certified" || raw === "cpo") {
    return { label: "Certified pre-owned", schema: "https://schema.org/UsedCondition" };
  }
  return { label: "Used", schema: "https://schema.org/UsedCondition" };
}

function jsonLdForVehicle(
  listing: Listing,
  vin: string,
  canonicalUrl: string,
  name: string,
  price: number | null,
  mileage: number | null,
  condition: { schema: string },
  availability: string,
  imageUrl: string | null,
  dealer: string,
  city: string,
  state: string,
): string {
  const address =
    city || state
      ? {
          "@type": "PostalAddress",
          ...(city ? { addressLocality: city } : {}),
          ...(state ? { addressRegion: state } : {}),
          addressCountry: "US",
        }
      : undefined;

  const seller = {
    "@type": "AutoDealer",
    name: dealer || "Dealer",
    ...(address ? { address } : {}),
  };

  const offer = {
    "@type": "Offer",
    url: canonicalUrl,
    ...(price != null && price > 0 ? { price: String(Math.round(price)) } : {}),
    priceCurrency: "USD",
    availability,
    itemCondition: condition.schema,
    seller,
  };

  const vehicle = {
    "@type": "Vehicle",
    "@id": `${canonicalUrl}#vehicle`,
    url: canonicalUrl,
    name,
    vehicleIdentificationNumber: vin,
    ...(text(listing.make) ? { brand: { "@type": "Brand", name: text(listing.make) } } : {}),
    ...(text(listing.model) ? { model: text(listing.model) } : {}),
    ...(text(listing.trim) ? { vehicleConfiguration: text(listing.trim) } : {}),
    ...(text(listing.year) ? { vehicleModelDate: text(listing.year) } : {}),
    ...(mileage != null ? {
      mileageFromOdometer: {
        "@type": "QuantitativeValue",
        value: Math.round(mileage),
        unitCode: "SMI",
      },
    } : {}),
    itemCondition: condition.schema,
    ...(imageUrl ? { image: imageUrl } : {}),
    offers: offer,
  };

  const product = {
    "@type": "Product",
    "@id": `${canonicalUrl}#product`,
    url: canonicalUrl,
    name,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    sku: vin,
    mpn: vin,
    ...(text(listing.make) ? { brand: { "@type": "Brand", name: text(listing.make) } } : {}),
    offers: offer,
    additionalProperty: [
      { "@type": "PropertyValue", name: "VIN", value: vin },
      ...(mileage != null
        ? [{ "@type": "PropertyValue", name: "Mileage", value: `${Math.round(mileage)} miles` }]
        : []),
      { "@type": "PropertyValue", name: "Availability", value: "In stock" },
    ],
  };

  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [vehicle, product],
    },
    null,
    2,
  ).replace(/</g, "\\u003c");
}

function pageShell(
  title: string,
  description: string,
  canonicalUrl: string,
  body: string,
  jsonLd?: string,
  robots = "index, follow",
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="product">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:site_name" content="AutoNegotiating.com">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <style>
    :root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1A1A18;background:#FAFAF7}
    *{box-sizing:border-box}body{margin:0}a{color:#A34A12}header{background:#fff;border-bottom:1px solid #E8E8E2;padding:18px 24px}
    header a{text-decoration:none;color:#1A1A18;font-family:Georgia,serif;font-size:22px;font-weight:700}
    header a em{color:#C95E1A;font-style:normal}main{max-width:1100px;margin:0 auto;padding:28px 24px 60px}
    .breadcrumbs{font-size:13px;color:#8A8A84;margin-bottom:24px}.breadcrumbs a{color:#4A4A46;text-decoration:none}
    .breadcrumbs span{margin:0 8px;color:#B0B0AA}.vehicle{background:#fff;border:1px solid #E8E8E2;border-radius:14px;overflow:hidden}
    .vehicle-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:0}
    .vehicle-image{background:#F0EDE8;min-height:320px;display:flex;align-items:center;justify-content:center}
    .vehicle-image img{display:block;width:100%;height:100%;min-height:320px;max-height:540px;object-fit:cover}
    .image-placeholder{padding:48px;color:#8A8A84;text-align:center}.vehicle-info{padding:32px}
    h1{font-family:Georgia,serif;font-size:clamp(28px,4vw,44px);line-height:1.1;margin:0 0 10px}
    .vin{color:#8A8A84;font-size:13px;letter-spacing:.04em;margin-bottom:22px}.price{font-size:28px;font-weight:700;color:#C95E1A;margin-bottom:22px}
    dl{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;margin:0}.field dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8A8A84}.field dd{margin:2px 0 0;font-size:15px;color:#1A1A18}
    .dealer{border-top:1px solid #E8E8E2;margin-top:26px;padding-top:20px}.dealer h2{font-size:16px;margin:0 0 6px}.dealer p{margin:3px 0;color:#4A4A46}
    .source-link{display:inline-block;margin-top:22px;background:#C95E1A;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:600}
    .summary{padding:24px 32px;border-top:1px solid #E8E8E2}.summary h2{font-family:Georgia,serif;margin:0 0 8px;font-size:22px}.summary p{margin:0;color:#4A4A46}
    .not-found{max-width:680px;margin:60px auto;background:#fff;border:1px solid #E8E8E2;border-radius:14px;padding:40px}.not-found h1{font-size:32px}
    @media(max-width:720px){main{padding:20px 16px 40px}.vehicle-grid{grid-template-columns:1fr}.vehicle-info{padding:24px}.summary{padding:22px 24px}.vehicle-image,.vehicle-image img{min-height:220px}}
  </style>
${jsonLd ? `  <script type="application/ld+json">${jsonLd}</script>` : ""}
</head>
<body>
  <header><a href="/"><span>Auto</span><em>Negotiating</em><span>.com</span></a></header>
  ${body}
</body>
</html>`;
}

export function renderVehiclePage(listing: Listing, vin: string): string {
  const year = text(listing.year);
  const make = text(listing.make);
  const model = text(listing.model);
  const trim = text(listing.trim);
  const name = vehicleName(listing) || `Vehicle ${vin}`;
  const title = `${name} for Sale | AutoNegotiating.com`;
  const price = toNumber(listing.priceUnformatted) ?? toNumber(listing.price);
  const mileage = toNumber(listing.mileageUnformatted) ?? toNumber(listing.mileage);
  const condition = getCondition(listing);
  const dealer = text(listing.dealerName) || text(listing.dealer) || "Dealer";
  const location = getLocation(listing);
  const imageUrl = getPhotoUrl(listing);
  const source = sourceListingUrl(listing);
  const canonicalUrl = `${SITE_ORIGIN}/vehicle/${encodeURIComponent(vin)}`;
  const availability = "https://schema.org/InStock";
  const description = `${name} listed at ${formatCurrency(price)} with ${formatMileage(mileage)} in ${[location.city, location.state].filter(Boolean).join(", ") || "the United States"}. VIN ${vin}.`;
  const searchUrl = `/?${new URLSearchParams({ ...(make ? { make } : {}), ...(model ? { model } : {}) }).toString()}`;
  const jsonLd = jsonLdForVehicle(
    listing,
    vin,
    canonicalUrl,
    name,
    price,
    mileage,
    condition,
    availability,
    imageUrl,
    dealer,
    location.city,
    location.state,
  );

  const body = `<main>
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <a href="/">Home</a><span aria-hidden="true">›</span>
    ${make && model ? `<a href="${escapeHtml(searchUrl)}">${escapeHtml(`${make} ${model}`)}</a><span aria-hidden="true">›</span>` : ""}
    <span aria-current="page">${escapeHtml(vin)}</span>
  </nav>
  <article class="vehicle">
    <div class="vehicle-grid">
      <div class="vehicle-image">
        ${
          imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" width="1024" height="768">`
            : `<div class="image-placeholder">Primary vehicle image unavailable</div>`
        }
      </div>
      <section class="vehicle-info">
        <h1>${escapeHtml(name)}</h1>
        <div class="vin">VIN: ${escapeHtml(vin)}</div>
        <div class="price">${escapeHtml(formatCurrency(price))}</div>
        <dl>
          <div class="field"><dt>Year</dt><dd>${escapeHtml(year || "Not provided")}</dd></div>
          <div class="field"><dt>Make</dt><dd>${escapeHtml(make || "Not provided")}</dd></div>
          <div class="field"><dt>Model</dt><dd>${escapeHtml(model || "Not provided")}</dd></div>
          <div class="field"><dt>Trim</dt><dd>${escapeHtml(trim || "Standard")}</dd></div>
          <div class="field"><dt>Mileage</dt><dd>${escapeHtml(formatMileage(mileage))}</dd></div>
          <div class="field"><dt>Condition</dt><dd>${escapeHtml(condition.label)}</dd></div>
          <div class="field"><dt>Availability</dt><dd>In stock</dd></div>
        </dl>
        <div class="dealer">
          <h2>Dealer</h2>
          <p>${escapeHtml(dealer)}</p>
          <p>${escapeHtml([location.city, location.state].filter(Boolean).join(", ") || "Location not provided")}</p>
        </div>
        ${
          source.url
            ? `<a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}</a>`
            : `<p class="dealer">${escapeHtml(source.label)}</p>`
        }
      </section>
    </div>
    <section class="summary">
      <h2>Vehicle details</h2>
      <p>${escapeHtml(name)} is currently listed as ${escapeHtml(condition.label.toLowerCase())} with ${escapeHtml(formatMileage(mileage).toLowerCase())} at ${escapeHtml(dealer)} in ${escapeHtml([location.city, location.state].filter(Boolean).join(", ") || "the United States")}.</p>
    </section>
  </article>
</main>`;

  return pageShell(title, description, canonicalUrl, body, jsonLd);
}

export function renderVehicleNotFoundPage(vin: string): string {
  const canonicalUrl = `${SITE_ORIGIN}/vehicle/${encodeURIComponent(vin)}`;
  const title = `Vehicle ${vin} Not Found | AutoNegotiating.com`;
  const description = `The vehicle listing for VIN ${vin} is no longer available on AutoNegotiating.com.`;
  const body = `<main><section class="not-found">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(vin)}</span></nav>
  <h1>Vehicle listing unavailable</h1>
  <p>We could not find an active listing for VIN <strong>${escapeHtml(vin)}</strong>. The vehicle may have been sold or removed by the dealer.</p>
  <p><a href="/">Return to vehicle search</a></p>
</section></main>`;
  return pageShell(title, description, canonicalUrl, body, undefined, "noindex, follow");
}

export function renderVehicleTemporaryErrorPage(vin: string): string {
  const title = `Vehicle ${vin} | AutoNegotiating.com`;
  const description = "Vehicle details are temporarily unavailable. Please try again shortly.";
  const body = `<main><section class="not-found">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(vin)}</span></nav>
  <h1>Vehicle details temporarily unavailable</h1>
  <p>We could not reach the live inventory source. Please try again shortly.</p>
  <p><a href="/">Return to vehicle search</a></p>
</section></main>`;
  return pageShell(
    title,
    description,
    `${SITE_ORIGIN}/vehicle/${encodeURIComponent(vin)}`,
    body,
    undefined,
    "noindex, nofollow",
  );
}

export function extractListings(result: unknown): Listing[] {
  if (Array.isArray(result)) return result.filter((value): value is Listing => Boolean(value && typeof value === "object"));
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  for (const key of ["records", "listings", "data", "hits"]) {
    if (Array.isArray(record[key])) {
      return record[key].filter((value): value is Listing => Boolean(value && typeof value === "object"));
    }
  }
  return [];
}

export function siteOrigin(): string {
  return SITE_ORIGIN;
}
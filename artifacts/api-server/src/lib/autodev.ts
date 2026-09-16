import { Pool } from "undici";

const BASE_ORIGIN = "https://auto.dev";
const BASE_PATH = "/api";
const V2_ORIGIN = "https://api.auto.dev";

function getKey(): string {
  const key = process.env.AUTODEV_API_KEY?.trim();
  if (!key) throw new Error("AUTODEV_API_KEY is not set");
  return key;
}

// Use a connection pool (not a single-socket Client) so concurrent requests
// (trims, inventory, comparables, vin) don't serialize behind one another.
// maxHeaderSize increased to 64 KB (default is 16 KB) because some auto.dev
// responses (e.g. BMW 5 Series) carry unusually large Cloudflare response
// headers that exceed undici's default limit and throw HeadersOverflowError.
// Explicit timeouts ensure one hung upstream request can't stall the pool
// (and therefore other unrelated requests) for minutes.
const pool = new Pool(BASE_ORIGIN, {
  maxHeaderSize: 65536,
  connections: 10,
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
  connectTimeout: 10_000,
});

const v2Pool = new Pool(V2_ORIGIN, {
  maxHeaderSize: 65536,
  connections: 10,
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
  connectTimeout: 10_000,
});

export async function autodevGet(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set("apikey", getKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      qs.set(k, String(v));
    }
  }

  const reqPath = `${BASE_PATH}${path}?${qs.toString()}`;
  const { statusCode, body } = await pool.request({
    method: "GET",
    path: reqPath,
  });

  if (statusCode >= 400) {
    let errBody = "";
    try { errBody = await body.text(); } catch { /* ignore */ }
    throw new Error(`auto.dev ${path} → ${statusCode}: ${errBody}`);
  }

  return body.json();
}

export async function autodevV2Get(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }

  const { statusCode, body } = await v2Pool.request({
    method: "GET",
    path: `${path}?${qs.toString()}`,
    headers: { authorization: `Bearer ${getKey()}` },
  });

  if (statusCode >= 400) {
    let errBody = "";
    try { errBody = await body.text(); } catch { /* ignore */ }
    throw new Error(`auto.dev v2 ${path} → ${statusCode}: ${errBody}`);
  }

  return body.json();
}

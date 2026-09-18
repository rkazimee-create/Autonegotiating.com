import { logger } from "./logger";

export const INDEXNOW_ORIGIN = "https://www.autonegotiating.com";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_BATCH = 10_000;
const DEBOUNCE_MS = 750;
const DEDUPE_TTL_MS = 5 * 60 * 1000;
const pending = new Set<string>();
const recentlyQueued = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
let draining = false;

export function indexNowKey(): string | undefined {
  const value = process.env.INDEXNOW_KEY;
  return value && /^[A-Za-z0-9_-]{8,200}$/.test(value) ? value : undefined;
}
export function chunkUrls(urls: Iterable<string>, size = MAX_BATCH): string[][] {
  const unique = [...new Set(urls)].filter((url) => /^https:\/\/www\.autonegotiating\.com\//.test(url));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
  return chunks;
}

export function dedupeRecentUrls(
  urls: Iterable<string>,
  recent: Map<string, number>,
  now: number,
  ttlMs: number,
): string[] {
  for (const [url, queuedAt] of recent) {
    if (now - queuedAt >= ttlMs) recent.delete(url);
  }
  const accepted: string[] = [];
  for (const url of new Set(urls)) {
    if (recent.has(url)) continue;
    recent.set(url, now);
    accepted.push(url);
  }
  return accepted;
}

export async function submitIndexNow(
  urls: Iterable<string>,
  fetcher: typeof fetch = fetch,
): Promise<number[]> {
  const key = indexNowKey();
  const batches = chunkUrls(urls);
  if (!key || !batches.length) return [];
  const statuses: number[] = [];
  const failures: Error[] = [];
  for (const urlList of batches) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher(ENDPOINT, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: "www.autonegotiating.com", key, keyLocation: `${INDEXNOW_ORIGIN}/${key}.txt`, urlList }),
      });
      if (!response.ok) throw new Error(`IndexNow HTTP ${response.status}`);
      statuses.push(response.status);
    } catch (err) {
      failures.push(err instanceof Error ? err : new Error("Unknown IndexNow batch failure"));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, `${failures.length} IndexNow batch submission(s) failed`);
  }
  return statuses;
}

export async function submitIndexNowSafely(
  urls: Iterable<string>,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const urlList = [...urls];
  try {
    await submitIndexNow(urlList, fetcher);
    return true;
  } catch (err) {
    logger.warn({ err, urlCount: urlList.length }, "IndexNow submission failed");
    return false;
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  const urls = [...pending]; pending.clear();
  try { await submitIndexNowSafely(urls); }
  finally { draining = false; if (pending.size) scheduleIndexNow(); }
}
function scheduleIndexNow(): void {
  if (timer) return;
  timer = setTimeout(() => { timer = undefined; void drain(); }, DEBOUNCE_MS);
}
export function queueIndexNow(urls: Iterable<string>): void {
  for (const url of dedupeRecentUrls(urls, recentlyQueued, Date.now(), DEDUPE_TTL_MS)) {
    pending.add(url);
  }
  if (pending.size) scheduleIndexNow();
}
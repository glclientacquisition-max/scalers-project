const hits = new Map<string, number[]>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 8;

export function rateLimitAccessRequest(clientKey: string): boolean {
  const key = clientKey || "unknown";
  const now = Date.now();
  const prev = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (prev.length >= MAX_PER_WINDOW) return true;
  prev.push(now);
  hits.set(key, prev);
  return false;
}

/** Test helper */
export function resetAccessRequestRateLimit(): void {
  hits.clear();
}

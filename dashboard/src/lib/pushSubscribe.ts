/** Validation for /api/push/subscribe. Pure: no I/O. */

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string | null;
  device_label: string | null;
};

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Accepts the browser's PushSubscription.toJSON() plus optional platform/label. */
export function parsePushSubscription(body: unknown): PushSubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sub = (b.subscription && typeof b.subscription === "object" ? b.subscription : b) as Record<string, unknown>;
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const keys = (sub.keys && typeof sub.keys === "object" ? sub.keys : {}) as Record<string, unknown>;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!p256dh || !auth || p256dh.length > 256 || auth.length > 64) return null;
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) return null;
  return {
    endpoint,
    p256dh,
    auth,
    platform: clip(b.platform, 32),
    device_label: clip(b.device_label, 60),
  };
}

export function parseEndpointOnly(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as Record<string, unknown>).endpoint;
  if (typeof e !== "string" || !e.trim() || e.length > 1024) return null;
  return e.trim();
}

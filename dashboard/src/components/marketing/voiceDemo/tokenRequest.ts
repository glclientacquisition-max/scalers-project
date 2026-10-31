export type DemoTokenBody = {
  tenant: string;
  lang: string;
  turnstile: string;
  device_id: string;
  consent_ts: string;
  notice_v: string;
};

export type DemoTokenResult =
  | { ok: true; token: string; wsUrl: string; maxSec: number }
  | { ok: false; status: number; reason: string };

const FALLBACK_MAX_SEC = 180;

/** POST /demo/token. The JSON field is device_id. */
export async function postDemoToken(
  tokenUrl: string,
  body: DemoTokenBody,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoTokenResult> {
  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, reason: "error" };
  }
  let payload: { token?: string; ws_url?: string; max_sec?: number; reason?: string } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    return { ok: false, status: response.status, reason: payload.reason || "error" };
  }
  if (!payload.token) return { ok: false, status: response.status, reason: "error" };
  return {
    ok: true,
    token: payload.token,
    wsUrl: payload.ws_url || "",
    maxSec: typeof payload.max_sec === "number" ? payload.max_sec : FALLBACK_MAX_SEC,
  };
}

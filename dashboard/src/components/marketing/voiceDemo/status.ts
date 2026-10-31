import type { DemoState } from "./machine";

export type DemoStatusBody = {
  enabled?: boolean;
  busy?: boolean;
  cap?: boolean;
  reason?: string | null;
};

export type StatusRead =
  | { kind: "block"; state: "disabled" | "busy" | "cap" }
  | { kind: "open" }
  | { kind: "quiet" }
  | { kind: "error" };

/** First of disabled, cap, busy. A clear line wins over a later flag. */
export function blockFromStatus(body: DemoStatusBody): "disabled" | "busy" | "cap" | null {
  if (body.reason === "disabled" || body.enabled === false) return "disabled";
  if (body.reason === "cap" || body.cap === true) return "cap";
  if (body.reason === "busy" || body.busy === true) return "busy";
  return null;
}

export function statusUrl(tokenUrl = "/demo/token"): string {
  if (tokenUrl.endsWith("/demo/token")) return tokenUrl.replace(/\/demo\/token$/, "/demo/status");
  return "/demo/status";
}

/**
 * GET /demo/status. A 429 rate limit is quiet: the visitor is not told.
 * Anything else that is not a block leaves the caller to show Start or a generic error.
 */
export async function readDemoStatus(
  fetchImpl: typeof fetch = fetch,
  url = "/demo/status",
): Promise<StatusRead> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch {
    return { kind: "quiet" };
  }
  if (response.status === 429) return { kind: "quiet" };
  if (!response.ok) return { kind: "error" };
  let body: DemoStatusBody = {};
  try {
    body = (await response.json()) as DemoStatusBody;
  } catch {
    return { kind: "error" };
  }
  const state = blockFromStatus(body);
  if (state) return { kind: "block", state };
  return { kind: "open" };
}

export function stateFromStatusRead(read: StatusRead): DemoState | null {
  if (read.kind === "block") return read.state;
  return null;
}

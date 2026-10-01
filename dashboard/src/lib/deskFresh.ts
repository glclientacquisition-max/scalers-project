import type { ThreadAnchor } from "@/lib/endlessList";

const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UsageLiveWatch = {
  table: "tenants" | "wallet_ledger";
  filter: string;
};

/**
 * Rows that move when a credit lands or included minutes change.
 * The tenant id is the primary key. The ledger is keyed by tenant_id.
 */
export function usageLiveWatches(tenantId: string): UsageLiveWatch[] {
  const id = String(tenantId || "").trim();
  return [
    { table: "tenants", filter: `id=eq.${id}` },
    { table: "wallet_ledger", filter: `tenant_id=eq.${id}` },
  ];
}

/** Starting M-Pesa is not a landed credit. The balance refresh waits for the row. */
export function refreshUsageOnPaymentStart(): boolean {
  return false;
}

/** Home and Usage are the surfaces that show the minute line and the balance. */
export function usageRouteNeedsRefresh(pathname: string): boolean {
  const path = String(pathname || "").split("?")[0].split("#")[0];
  return path === "/home" || path.startsWith("/home/") || path === "/wallet" || path.startsWith("/wallet/");
}

/**
 * A failed next page is not the end of Contacts. An empty page is.
 * `retry` keeps the rows already on screen.
 */
export function contactsSliceOutcome(input: {
  error: string | null;
  rowCount: number;
}): "retry" | "end" | "append" {
  if (input.error) return "retry";
  if (input.rowCount <= 0) return "end";
  return "append";
}

/**
 * Open-ticket transcript filter. Null when the id is not a call id,
 * so the subscription cannot be pointed at another table.
 */
export function liveTicketFilter(callId: string): string | null {
  const id = String(callId || "").trim();
  if (!CALL_ID.test(id)) return null;
  return `call_id=eq.${id}`;
}

/**
 * Where the thread should sit after a transcript refresh.
 * Pinned to the latest line follows the new bottom.
 * Scrolled up stays on the same offset. Start stays at the top.
 */
export function transcriptRefreshTop(input: {
  anchor: ThreadAnchor;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): number {
  if (input.anchor === "older") return Math.max(0, input.scrollTop);
  if (input.anchor === "start") return 0;
  return Math.max(0, input.scrollHeight - input.clientHeight);
}

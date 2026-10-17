/**
 * Desk mirror of the voice gate's closed-line rule (src/sautikit/inactiveTenantGate.js,
 * tenantLineInactiveReason). Pure module, no `@/` imports, so node tests load it next to the
 * gate and assert both give the same answer for every row shape (tests/tenantLineGuards.test.js).
 * Change one, change both; the parity test fails otherwise.
 *
 * Desk meaning:
 * - archived (archived_at set) or inactive (is_active = false): the business is closed.
 *   No Desk, no sends, no writes.
 * - suspended (line_status = 'suspended'): the line is paused. The owner can still read
 *   calls, contacts and settings; nothing goes out to callers or teammates.
 */

export type TenantLineRow = {
  is_active?: boolean | null;
  archived_at?: string | null;
  archived?: boolean | null;
  line_status?: string | null;
};

export type TenantLineReason = "archived" | "suspended" | "inactive";
export type DeskLineState = "open" | "paused" | "closed";

export const LINE_PAUSED_SEND_ERROR = "Your line is paused, so messages can't go out right now.";
export const LINE_PAUSED_PING_ERROR = "Your line is paused, so teammates can't be pinged right now.";
export const BUSINESS_CLOSED_ERROR = "This business is closed.";
export const LINE_PAUSED_BANNER = "Your line is paused. Callers hear that the line is unavailable.";

function rowArchived(row: TenantLineRow): boolean {
  if (row.archived === true) return true;
  return Boolean(row.archived_at);
}

function rowSuspended(row: TenantLineRow): boolean {
  return String(row.line_status || "").trim().toLowerCase() === "suspended";
}

/** Same order and rules as the voice gate: archived, then suspended, then is_active = false. */
export function tenantLineInactiveReason(row: TenantLineRow | null | undefined): TenantLineReason | null {
  if (!row || typeof row !== "object") return null;
  if (rowArchived(row)) return "archived";
  if (rowSuspended(row)) return "suspended";
  if (row.is_active === false) return "inactive";
  return null;
}

/** True when callers hear "line unavailable" (archived, suspended or inactive). */
export function tenantLineClosed(row: TenantLineRow | null | undefined): boolean {
  return tenantLineInactiveReason(row) !== null;
}

/** Archived or switched off wins over suspended: a closed business never shows as paused. */
export function deskLineState(row: TenantLineRow | null | undefined): DeskLineState {
  const reason = tenantLineInactiveReason(row);
  if (!reason) return "open";
  if (reason === "suspended" && row?.is_active !== false) return "paused";
  return "closed";
}

export type SendBlock = { reason: "line_paused" | "business_closed"; message: string };

/** Why an outbound Desk message must not go out, or null when it may. */
export function sendBlock(row: TenantLineRow | null | undefined): SendBlock | null {
  const state = deskLineState(row);
  if (state === "closed") return { reason: "business_closed", message: BUSINESS_CLOSED_ERROR };
  if (state === "paused") return { reason: "line_paused", message: LINE_PAUSED_SEND_ERROR };
  return null;
}

/** Plain owner message for a blocked send reason, or null for any other reason. */
export function sendBlockMessage(reason: string | null | undefined): string | null {
  if (reason === "business_closed") return BUSINESS_CLOSED_ERROR;
  if (reason === "line_paused") return LINE_PAUSED_SEND_ERROR;
  return null;
}

/** Owner text for a refused teammate ping, from our own line check (sendBlock reason). */
export function pingBlockMessage(block: SendBlock): string {
  return block.reason === "line_paused" ? LINE_PAUSED_PING_ERROR : BUSINESS_CLOSED_ERROR;
}

/**
 * Owner text for the voice server's refusal (409 { ok: false, reason: "tenant_line_closed", lineState }).
 * lineState is the gate's reason ("archived" | "suspended" | "inactive"), either as a string or as
 * { reason }. Returns null for any other response.
 */
export function escalateRefusalMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const body = json as { reason?: unknown; lineState?: unknown };
  if (String(body.reason || "") !== "tenant_line_closed") return null;
  const raw =
    body.lineState && typeof body.lineState === "object"
      ? (body.lineState as { reason?: unknown; state?: unknown }).reason ??
        (body.lineState as { state?: unknown }).state
      : body.lineState;
  const state = String(raw || "").trim().toLowerCase();
  return state === "suspended" || state === "paused" ? LINE_PAUSED_PING_ERROR : BUSINESS_CLOSED_ERROR;
}

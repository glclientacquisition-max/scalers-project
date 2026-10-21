/**
 * One shared definition of every Desk work count (owner review, 18 Oct 2026).
 *
 * Home ("Return calls 76"), the Inbox tabs ("Needs you 78", "Return calls 31",
 * "Holds 45") and the nav badge ("9+") each counted with their own predicate:
 * Home folded open enquiry/callback requests into "to return" while the Inbox
 * filed them under Holds, the Inbox "Return calls" tab counted resolved calls,
 * and a call stuck at in_progress stayed "Live" (and in Needs you) for days.
 *
 * Every screen now asks these predicates. Relative imports only, so node tests
 * can load this file directly.
 */

export type CountableItem = {
  purpose: string;
  needsYou: boolean;
  createdAt: string;
  lead?: { leadStatus?: string | null } | null;
  hold?: { status?: string | null; request_type?: string | null; inbox_archived_at?: string | null } | null;
  job?: { status?: string | null; inbox_archived_at?: string | null } | null;
};

/** A call row still "in progress" after this long is a stale status, not a live call. */
export const LIVE_STALE_MS = 2 * 60 * 60 * 1000;

const HOLD_REQUEST_TYPES = new Set(["hold", "order", "hold_or_pickup"]);

/** service_requests.request_type values that are a hold or an order (not an enquiry or callback). */
export function isHoldRequestType(type: unknown): boolean {
  return HOLD_REQUEST_TYPES.has(String(type || "").trim().toLowerCase());
}

function lower(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

/**
 * The call row is archived, or a hold/visit row with no call row of its own
 * was archived with its call (inbox_archive_calls stamps inbox_archived_at).
 * The loader clears a stamp whose call is no longer archived, so an
 * Unarchive of the call brings its requests back.
 */
export function countIsArchived(item: CountableItem): boolean {
  if (item.lead) return item.lead.leadStatus === "archived";
  return Boolean(item.hold?.inbox_archived_at || item.job?.inbox_archived_at);
}

/** Live only while the call is recent. An old in_progress row is history. */
export function itemIsFreshLive(item: CountableItem, now = Date.now()): boolean {
  if (item.purpose !== "live") return false;
  const at = Date.parse(item.createdAt);
  if (!Number.isFinite(at)) return false;
  return now - at < LIVE_STALE_MS;
}

/** Needs you: open work, not archived, and a "live" row only while it is really live. */
export function itemNeedsYouNow(item: CountableItem, now = Date.now()): boolean {
  if (countIsArchived(item) || !item.needsYou) return false;
  if (item.purpose === "live") return itemIsFreshLive(item, now);
  return true;
}

function openRequest(item: CountableItem): boolean {
  return lower(item.hold?.status) === "open";
}

/** An open hold or order: something to fulfil. */
export function itemIsOpenHold(item: CountableItem): boolean {
  return !countIsArchived(item) && openRequest(item) && isHoldRequestType(item.hold?.request_type);
}

/**
 * A caller to get back to: an asked-for person or a missed call that is still
 * open, or an open enquiry/callback request. Resolved calls are not "to return".
 */
export function itemIsToReturn(item: CountableItem, now = Date.now()): boolean {
  if (!itemNeedsYouNow(item, now)) return false;
  if (item.job) return false;
  if (item.hold) return openRequest(item) && !isHoldRequestType(item.hold.request_type);
  return item.purpose === "human" || item.purpose === "missed";
}

/** A visit that is requested (to confirm) or confirmed (booked). */
export function itemIsOpenVisit(item: CountableItem): boolean {
  if (countIsArchived(item)) return false;
  const status = lower(item.job?.status);
  return status === "requested" || status === "confirmed";
}

export function itemIsVisitToConfirm(item: CountableItem): boolean {
  return !countIsArchived(item) && lower(item.job?.status) === "requested";
}

export type DeskWorkCounts = {
  needs: number;
  toReturn: number;
  holds: number;
  visits: number;
  visitsToConfirm: number;
  answered: number;
  archived: number;
  all: number;
};

/** The single selector. Home, Inbox tabs and the nav badge all read this. */
export function deskWorkCounts(items: readonly CountableItem[], now = Date.now()): DeskWorkCounts {
  const out: DeskWorkCounts = {
    needs: 0,
    toReturn: 0,
    holds: 0,
    visits: 0,
    visitsToConfirm: 0,
    answered: 0,
    archived: 0,
    all: 0,
  };
  for (const item of items) {
    if (countIsArchived(item)) {
      out.archived += 1;
      continue;
    }
    out.all += 1;
    if (itemNeedsYouNow(item, now)) out.needs += 1;
    if (itemIsToReturn(item, now)) out.toReturn += 1;
    if (itemIsOpenHold(item)) out.holds += 1;
    if (itemIsOpenVisit(item)) out.visits += 1;
    if (itemIsVisitToConfirm(item)) out.visitsToConfirm += 1;
    if (item.purpose === "answered") out.answered += 1;
  }
  return out;
}

/** Nav badge text. Shows the real number up to 99 so it matches the Needs you tab. */
export function formatNeedsBadge(count: number): string | null {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  return n > 99 ? "99+" : String(n);
}

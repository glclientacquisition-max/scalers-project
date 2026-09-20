import { itemIsArchived, type InboxItem } from "@/lib/inboxPurpose";

export type InboxListActionId =
  | "pin"
  | "unpin"
  | "mark_done"
  | "confirm"
  | "done"
  | "archive"
  | "unarchive";

export type InboxListAction = {
  id: InboxListActionId;
  label: string;
  divide?: boolean;
};

export type InboxBulkSharedAction = "confirm" | "done" | "mark_done";
export type InboxBulkLeaveAction = "archive" | "unarchive";

/** Confirm is only valid on a requested appointment row. */
export function inboxCanConfirm(item: InboxItem): boolean {
  if (itemIsArchived(item)) return false;
  return String(item.job?.status || "").toLowerCase() === "requested";
}

/** Hold Done is only valid on an open service_request row. */
export function inboxCanHoldDone(item: InboxItem): boolean {
  if (itemIsArchived(item)) return false;
  return String(item.hold?.status || "").toLowerCase() === "open";
}

/** Visit Done is only valid on a confirmed appointment row. Not a Needs you verb. */
export function inboxCanVisitDone(item: InboxItem): boolean {
  if (itemIsArchived(item)) return false;
  return String(item.job?.status || "").toLowerCase() === "confirmed";
}

export type InboxListDockRecipe = "confirm" | "visit_done" | "hold_done" | "call_wa" | "none";

/**
 * List Action dock. Confirm owns requested visits. Hold Done owns open holds.
 * Intent-only work never gets Confirm or Done. Call plus WhatsApp needs a number.
 */
export function inboxListDockRecipe(item: InboxItem): InboxListDockRecipe {
  if (itemIsArchived(item)) {
    return item.callerPhone ? "call_wa" : "none";
  }
  if (inboxCanConfirm(item)) return "confirm";
  if (inboxCanVisitDone(item)) return "visit_done";
  if (inboxCanHoldDone(item)) return "hold_done";
  if (item.callerPhone) return "call_wa";
  return "none";
}

/**
 * Return-call close. Confirm owns visits. Hold Done owns holds.
 * Answered and live rows are already off that job.
 */
export function inboxCanMarkDone(item: InboxItem): boolean {
  if (itemIsArchived(item)) return false;
  if (item.job || item.hold) return false;
  if (item.purpose !== "human" && item.purpose !== "missed") return false;
  return String(item.lead?.leadStatus || "").toLowerCase() !== "resolved";
}

/**
 * Ticket Mark done uses the same rules as list/bulk (`inboxCanMarkDone`).
 * Confirm owns visits. Hold Done owns holds.
 */
export function inboxTicketCanMarkDone(opts: {
  archived: boolean;
  purpose: InboxItem["purpose"];
  hasJob: boolean;
  hasHold: boolean;
  leadStatus?: string | null;
}): boolean {
  if (opts.archived) return false;
  if (opts.hasJob || opts.hasHold) return false;
  if (opts.purpose !== "human" && opts.purpose !== "missed") return false;
  return String(opts.leadStatus || "").toLowerCase() !== "resolved";
}

/** Ticket ⋮: Archive. Unarchive when archived. Mark done lives on the action dock. */
export function inboxTicketOverflowActions(opts: {
  archived: boolean;
}): InboxListAction[] {
  if (opts.archived) return [{ id: "unarchive", label: "Unarchive" }];
  return [{ id: "archive", label: "Archive" }];
}

/** md+ overflow: Pin, Mark done when eligible, Archive or Unarchive. No Select. */
export function inboxOverflowActions(item: InboxItem): InboxListAction[] {
  const stay: InboxListAction[] = [
    item.pinnedAt ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin" },
  ];
  if (inboxCanMarkDone(item)) stay.push({ id: "mark_done", label: "Mark done" });
  const leave: InboxListAction = itemIsArchived(item)
    ? { id: "unarchive", label: "Unarchive", divide: true }
    : { id: "archive", label: "Archive", divide: true };
  return [...stay, leave];
}

/** Unarchive only when every selected row is already archived. */
export function inboxBulkLeaveAction(items: InboxItem[]): InboxBulkLeaveAction | null {
  if (!items.length) return null;
  if (items.every(itemIsArchived)) return "unarchive";
  if (items.some(itemIsArchived)) return null;
  return "archive";
}

/** Confirm, Hold Done, or Mark done only when every selected row shares that same valid action. */
export function inboxBulkSharedAction(
  items: InboxItem[]
): InboxBulkSharedAction | null {
  if (!items.length) return null;
  if (items.every(inboxCanConfirm)) return "confirm";
  if (items.every(inboxCanHoldDone)) return "done";
  if (items.every(inboxCanMarkDone)) return "mark_done";
  return null;
}

/** Header select bar: only verbs true for every selected row. */
export function inboxBulkActions(items: InboxItem[]): InboxListAction[] {
  if (!items.length) return [];
  const out: InboxListAction[] = [];
  const leave = inboxBulkLeaveAction(items);
  if (leave === "archive") out.push({ id: "archive", label: "Archive" });
  if (leave === "unarchive") out.push({ id: "unarchive", label: "Unarchive" });
  if (items.every(inboxCanConfirm)) out.push({ id: "confirm", label: "Confirm" });
  if (items.every(inboxCanHoldDone)) out.push({ id: "done", label: "Hold Done" });
  if (items.every(inboxCanMarkDone)) out.push({ id: "mark_done", label: "Mark done" });
  return out;
}

import { itemIsArchived, type InboxItem } from "@/lib/inboxPurpose";

export type InboxListActionId = "archive";

export type InboxListAction = {
  id: InboxListActionId;
  label: string;
  divide?: boolean;
};

export type InboxBulkSharedAction = "confirm" | "done";

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

/** Overflow is Archive only. Other list verbs are not offered. */
export function inboxOverflowActions(item: InboxItem): InboxListAction[] {
  if (itemIsArchived(item)) return [];
  return [{ id: "archive", label: "Archive" }];
}

/** Confirm or Done on the bulk bar only when every selected row shares that same valid action. */
export function inboxBulkSharedAction(
  items: InboxItem[]
): InboxBulkSharedAction | null {
  if (!items.length) return null;
  if (items.every(inboxCanConfirm)) return "confirm";
  if (items.every(inboxCanHoldDone)) return "done";
  return null;
}

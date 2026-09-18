import { itemIsArchived, type InboxItem } from "@/lib/inboxPurpose";

export type InboxListActionId = "select" | "pin" | "done" | "archive" | "unarchive";

export type InboxListAction = {
  id: InboxListActionId;
  label: string;
  divide?: boolean;
};

/** Mark done is the return-call close. Confirm and hold Done own the books. */
export function inboxCanMarkDone(item: InboxItem): boolean {
  if (itemIsArchived(item)) return false;
  if (item.purpose === "live") return false;
  if (item.job || item.hold) return false;
  if (item.lead?.leadStatus === "resolved") return false;
  return true;
}

/** Stay: Select, Pin. Leave: Mark done when the dock is Call / WhatsApp, then Archive or Unarchive. */
export function inboxOverflowActions(item: InboxItem): InboxListAction[] {
  const archived = itemIsArchived(item);
  const canDone = inboxCanMarkDone(item);
  const actions: InboxListAction[] = [
    { id: "select", label: "Select" },
    { id: "pin", label: item.pinnedAt ? "Unpin" : "Pin" },
  ];
  if (canDone) actions.push({ id: "done", label: "Mark done", divide: true });
  actions.push({
    id: archived ? "unarchive" : "archive",
    label: archived ? "Unarchive" : "Archive",
    divide: !canDone,
  });
  return actions;
}

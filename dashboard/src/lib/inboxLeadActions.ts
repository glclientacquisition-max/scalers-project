import { updateAppointmentStatus } from "@/app/(desk)/appointments/actions";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import { updateServiceRequestStatus } from "@/app/(desk)/requests/actions";
import {
  inboxAddLabel as writeInboxLabel,
  inboxAssignTeammate as writeInboxAssignee,
  inboxMarkSeen as writeInboxSeen,
  inboxSnooze as writeInboxSnooze,
  inboxToggleMute as writeInboxMute,
  inboxTogglePin as writeInboxPin,
  inboxToggleRead as writeInboxRead,
} from "@/app/(desk)/calls/inboxTriageActions";
import type { InboxItem } from "@/lib/inboxPurpose";

/** Same handler as ticket Mark done (`MarkLeadDoneButton` → `updateLeadStatus`). */
export async function inboxMarkDone(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return updateLeadStatus(item.callId, "resolved");
}

/** Same handler as ticket Archive (`MarkLeadArchiveButton` → `updateLeadStatus`). */
export async function inboxArchive(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return updateLeadStatus(item.callId, "archived");
}

/** Same handler as list Confirm (`InboxJobActions` → `updateAppointmentStatus`). */
export async function inboxConfirm(item: InboxItem) {
  if (!item.job?.id) return { error: "Missing appointment." };
  const form = new FormData();
  form.set("id", item.job.id);
  form.set("status", "confirmed");
  return updateAppointmentStatus({}, form);
}

/** Same handler as list hold Done (`RequestStatusToggle` → `updateServiceRequestStatus`). */
export async function inboxHoldDone(item: InboxItem) {
  if (!item.hold?.id) return { error: "Missing hold." };
  const form = new FormData();
  form.set("id", item.hold.id);
  form.set("status", "fulfilled");
  return updateServiceRequestStatus({}, form);
}

/** Same handler as ticket Unarchive (`MarkLeadUnarchiveButton` → `updateLeadStatus`). */
export async function inboxUnarchive(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return updateLeadStatus(item.callId, "new");
}

/** Owners cannot hard-delete calls. Delete is Archive. */
export async function inboxDelete(item: InboxItem) {
  return inboxArchive(item);
}

export async function inboxToggleRead(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxRead(item.callId, item.unread);
}

/** Unused by the list dot. Leaves `inbox_read_at` available without a schema revert. */
export async function inboxMarkSeen(callId: string) {
  const id = String(callId || "").trim();
  if (!id) return { error: "Missing call." };
  return writeInboxSeen(id);
}

export async function inboxToggleMute(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxMute(item.callId, item.muted);
}

export async function inboxTogglePin(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxPin(item.callId, item.pinnedAt);
}

export async function inboxAssign(item: InboxItem, assignee: string) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxAssignee(item.callId, assignee);
}

export async function inboxAddLabel(item: InboxItem, label: string) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxLabel(item.callId, label);
}

export async function inboxSnooze(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxSnooze(item.callId);
}

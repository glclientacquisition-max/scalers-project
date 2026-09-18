import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import {
  inboxAddLabel as writeInboxLabel,
  inboxAssignTeammate as writeInboxAssignee,
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

/** Owners cannot hard-delete calls. Delete is Archive. */
export async function inboxDelete(item: InboxItem) {
  return inboxArchive(item);
}

export async function inboxToggleRead(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return writeInboxRead(item.callId, item.unread);
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

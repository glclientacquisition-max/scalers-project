import { updateAppointmentStatus } from "@/app/(desk)/appointments/actions";
import { logWhatsAppFollowUp, updateLeadStatus } from "@/app/(desk)/calls/actions";
import { updateServiceRequestStatus } from "@/app/(desk)/requests/actions";
import {
  inboxAddLabel as writeInboxLabel,
  inboxAssignTeammate as writeInboxAssignee,
  inboxMarkSeen as writeInboxSeen,
  inboxToggleMute as writeInboxMute,
  inboxTogglePin as writeInboxPin,
} from "@/app/(desk)/calls/inboxTriageActions";
import type { InboxItem } from "@/lib/inboxPurpose";

function isDeskHarness() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/dev/");
}

/** Same handler as ticket Mark done (`MarkLeadDoneButton` → `updateLeadStatus`). */
export async function inboxMarkDone(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  if (isDeskHarness()) return { ok: true };
  return updateLeadStatus(item.callId, "resolved");
}

/** wa.me click: same pile close as Mark done, plus "WhatsApp follow-up opened". */
export async function inboxWhatsAppFollowUp(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  return logWhatsAppFollowUp(item.callId);
}

/** Same handler as ticket Archive (`MarkLeadArchiveButton` → `updateLeadStatus`). */
export async function inboxArchive(item: InboxItem) {
  if (!item.callId) return { error: "Missing call." };
  if (isDeskHarness()) return { ok: true };
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
  if (isDeskHarness()) return { ok: true };
  return updateLeadStatus(item.callId, "new");
}

/** Owners cannot hard-delete calls. Delete is Archive. */
export async function inboxDelete(item: InboxItem) {
  return inboxArchive(item);
}

/** Stamp `inbox_read_at` when the owner opens `/calls/[id]`. Clears the unread dot, not Needs you. */
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
  if (isDeskHarness()) return { ok: true };
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

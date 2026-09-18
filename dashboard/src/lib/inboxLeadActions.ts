import { updateLeadStatus } from "@/app/(desk)/calls/actions";
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

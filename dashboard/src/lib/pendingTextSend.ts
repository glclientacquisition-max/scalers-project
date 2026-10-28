import { sendInboxReplySms, type SendCallerNoteState } from "@/app/(desk)/calls/noteActions";
import { OPTIMISTIC_OFFLINE_ERROR, settlePendingText } from "@/lib/pendingTexts";

/**
 * Send one text the thread already shows as Sending, then flip it. Runs
 * outside the composer's lifecycle so leaving the call view mid-send still
 * settles the bubble. Sent: the server row arrives with this response
 * (revalidatePath) and replaces the bubble. Tried but failed: the server row
 * shows Not delivered with its own Retry, so the bubble steps aside the same
 * way. Never tried: the bubble reads Not sent with Retry.
 */
export async function deliverPendingText(id: string, fd: FormData): Promise<SendCallerNoteState> {
  let res: SendCallerNoteState;
  try {
    res = await sendInboxReplySms({}, fd);
  } catch {
    res = { error: OPTIMISTIC_OFFLINE_ERROR };
  }
  if (res.ok) settlePendingText(id, { state: "sent" });
  else settlePendingText(id, { state: "failed", reason: res.error || "Send failed." });
  return res;
}

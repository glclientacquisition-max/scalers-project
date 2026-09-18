# Call detail

**Route:** `/calls/[id]`  
**Job:** Decide and reply. The list is who plus one preview. This page is the full record.

**Layout:** Fixed header, scrolling conversation, optional Confirm or hold Done banner, optional SMS dock. The thread is the only scrolling region.

**Header:** Avatar, name, and purpose stamp are one contact tap. Call is `tel:`. WhatsApp is `wa.me`. More is Archive only. The stamp is read-only `signalLabel` (Return call, Visit confirmed, Hold, Human asked, Missed, Answered, Live). No New / Followed Up / Done taxonomy.

**Urgency:** A strip under the header only when `needsYou`. Copy comes from Do next or the summary, not a generic template.

**Thread:** Want, Mood, and Done are centered muted system notices. FAQ ideas sit in the thread. Jump to latest appears when scrolled away from the bottom.

**Banner:** Confirm only when an appointments row is requested. Hold Done only when a service_request is open. Not for intent-only, Human, or Missed.

**SMS dock:** Shown when `needsYou` and the call is not archived. Growing input plus Send. Uses `sendInboxReplySms`, distinct from auto-SMS on Confirm. WhatsApp stays on the header icon.

**Back:** `DeskBack`, 44px. Label is Inbox.

**One recording.** A single `CallRecording` in the thread footer.

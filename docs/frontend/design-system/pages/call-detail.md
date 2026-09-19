# Call detail

**Route:** `/calls/[id]`  
**Job:** Decide and reply. The list is who plus one preview. This page is the full record.

**Layout:** Fixed header. From `lg`, summary left and transcript right (`lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]`). Below `lg`, the same two panes stack in that source order inside one scrolling region. Optional Confirm or hold Done banner and SMS dock stay full width under the split (one docked action zone at every width).

**Header:** Avatar, name, and purpose stamp are one contact tap. Call is `tel:`. WhatsApp is `wa.me`. More is a portaled menu aligned to the ⋮ (`placeInboxOverflowMenu`): Archive, or Unarchive when the call is archived. Not a sheet. Archive writes the Inbox Undo payload before `DeskBack` so the list toast survives the remount. Opening the ticket stamps `calls.inbox_read_at` (clears the list unread dot). Needs you stays until Confirm, Done, or Archive. The stamp is read-only `signalLabel` (Return call, Visit confirmed, Hold, Human asked, Missed, Answered, Live). No New / Followed Up / Done taxonomy.

**Urgency:** A strip under the header only when `needsYou`. Copy comes from Do next or the summary, not a generic template.

**Summary pane:** Want, Mood, and Done. Job and hold editors. Recording meta. Not duplicated in the thread.

**Thread:** Conversation and FAQ ideas. Jump to latest appears when scrolled away from the bottom.

**Banner:** Confirm only when an appointments row is requested and the call is not archived. Hold Done only when a service_request is open and the call is not archived. Not for intent-only, Human, or Missed. Sits above the SMS dock, full width.

**SMS dock:** Shown when `needsYou` and the call is not archived. Growing input, muted Polish wand, plus Send. Wand rewrites the current draft in the field. Empty draft stays empty. Wand hides when the dock hides (archived or no number). Send stays the filled primary. Uses `sendInboxReplySms`, distinct from auto-SMS on Confirm or Done. WhatsApp stays on the header icon. Spans the viewport under the split so Send stays docked at the bottom.

**Back:** `DeskBack`, icon-only chevron, 44px muted ghost. `aria-label` / `title` is Inbox. Sits in the header row with the contact, not on its own text row.

**One recording.** A single `CallRecording` in the summary pane.

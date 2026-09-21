# Call detail

**Route:** `/calls/[id]`  
**Job:** Decide and reply. The list is who plus one preview. This page is the full record.

**Layout:** No desk shell lockup. Thread height uses `--desk-header-h: 0`. Bottom tabs stay. Fixed ticket header (`DeskBack` + person + More). `data-desk-bleed` fills the column next to `DeskRail` on `md+`. From `lg`, summary left and transcript right (`lg:grid-cols-[minmax(18rem,var(--ticket-summary-w,22rem))_1px_minmax(0,1fr)]`). Drag the gutter or use arrow keys. Floor 18rem summary, 20rem thread, cap 32rem. Stored in `localStorage["scalers-ticket-split"]`. Double-click resets. Below `lg`, the same two panes stack in that source order inside one scrolling region. The action dock, optional Confirm or hold Done banner, and SMS dock stay full width under the split (one docked action zone at every width).

**Header:** `ContactStrip` in the same family as the Contacts Phase 1 list row. Avatar, display name (or Unsaved / Name this caller), one factual subline (`contactListSubline`: last call, Unsaved, or phone). Tap identity opens `/contacts/[id]`. Call + WhatsApp sit in the strip when a number exists (`deskHitClass`, `tel:` / `wa.me` opened only). No `callId`. No `lead_status` write-back from the strip. Ticket-dock WhatsApp still writes follow-up when the owner uses that dock. Icon-only hits (Back, Call, WhatsApp, More, Jump, Polish, Send) show `DeskHint` on hover and focus. More is a portaled menu aligned to the ⋮ (`placeInboxOverflowMenu`): Archive, or Unarchive when the call is archived. Not a sheet. Archive writes the Inbox Undo payload before `DeskBack` so the list toast survives the remount. Opening the ticket stamps `calls.inbox_read_at` (clears the list unread dot). Needs you stays until Confirm, Done, or Archive. The stamp is read-only `signalLabel` in the summary pane (Return call, Visit confirmed, Hold, Human asked, Missed, Answered, Live). No New / Followed Up / Done taxonomy. No Online, last seen, presence, or active now.

**Action dock:** One thumb row under the split. Mark done (return calls), Call (`tel:`), WhatsApp (`wa.me` write-back), Ping teammate. Each hit is `deskHitClass` (`h-12 w-12`) with a visible label. Same row on phone and desktop. Ticket chrome already clears `--desk-tabbar-h` plus `safe-area-inset-bottom`. Hidden when none of the four apply. Confirm and hold Done stay on their banners. Archive stays on More.

**Urgency:** A strip under the header only when `needsYou`. Copy comes from Do next or the summary, not a generic template.

**Summary pane:** Want, Mood, and Done. Job and hold editors. Recording meta. Not duplicated in the thread.

**Thread:** Conversation and FAQ ideas. Jump to latest appears when scrolled away from the bottom.

**Banner:** Confirm only when an appointments row is requested and the call is not archived. Hold Done only when a service_request is open and the call is not archived. Not for intent-only, Human, or Missed. Sits above the SMS dock, full width.

**SMS dock:** Shown when `needsYou` and the call is not archived. Growing input, muted Polish wand, plus Send. Wand rewrites the current draft in the field. Empty draft stays empty. Wand hides when the dock hides (archived or no number). Send stays the filled primary. Uses `sendInboxReplySms`, distinct from auto-SMS on Confirm or Done. WhatsApp stays on the action dock. Spans the viewport under the split so Send stays docked at the bottom.

**Back:** `DeskBack`, icon-only chevron, 44px muted ghost. `aria-label` / `title` is Inbox. `DeskHint` shows Inbox on hover. Sits in the header row with the contact, not on its own text row.

**One recording.** A single `CallRecording` in the summary pane.

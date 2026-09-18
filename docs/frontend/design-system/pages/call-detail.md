# Call detail

**Route:** `/calls/[id]`  
**Job:** Decide and reply. The list is who plus one preview. This page is the full record.

**Inside vs outside.** Gestalt: `md+` keeps Inbox beside the call, like WhatsApp. The call pane stacks: identity, Summary, Actions, Conversation, facts. Situation awareness: the stamp names the next action, not a brain id. Von Restorff: one filled verb for the current task. Fitts: that verb is full width. Progressive disclosure unwraps Want, Done, mood, and next here. Peak-end: empty transcript is `No conversation.`

**Layout:** Phone (`<md`) is a full call. `md+` is Inbox list left, call right. The list is a parallel `@inbox` slot, not nested in the call page. Compact Mail rows in that list pane. One named scroll on the list, one on the call. Esc and Close return to Inbox. Filter tabs stay on the open call.

**Identity once.** `h1` is the caller. If a contact file exists, that `h1` is the contact link. Status pills sit with the stamp. Phone repeats only when the title is a name. No "Open contact". No second Caller card or SID block.

**Stamp:** Same owner-language signal as Inbox (Confirm visit, Hold, Human asked). Not Job / Hold taxonomy.

**Left pane order:** identity (name, stamp, status pills, time, phone), Summary, Actions (one filled next step, then WhatsApp / SMS / Done / Archive), Visit/Hold schedule if present, Conversation, then a de-emphasized facts footer. Same source order as the screen. No `display: contents`.

**Back:** `DeskBack` Inbox on the phone. `md+` uses Close plus Esc. Restores pile, search, page, and visit layout. Contact opened from this page uses `DeskBack` Call.

**Full copy lives here.** Inbox and Contacts show one truncated preview. Want, Done, mood, and next unwrap on this page. Do not truncate the Summary card.

**Primary CTA:** One filled verb, centered with the rest of the action group (`max-w-lg`). Confirm or Done when a visit or hold is on the call (full width). Reply on WhatsApp when that is the current owner task. Brand-blue fill, white WhatsApp glyph (green-on-blue fails WCAG 1.4.11). SMS can be the filled control when WhatsApp is not the current task. Do next copy from the hangup card captions that verb. It is not a second handler. Mark done, Archive, Reply on WhatsApp, and Send SMS are `btnGhost` or `btnPrimary` with icon plus label. SMS compose stays collapsed until Send SMS. Compact list icons stay in the Inbox dock.

**Visit / Hold:** Confirm or Done full width. Cancel ghost below. Reopen lives here. Save on When/Where stays ghost. Failed Save is `Could not save.` Not on the list.

**Facts:** Duration. Assist in owner language (`callResolutionLabel`). Escalated-to name if present. No brain intent ids, no Alert sent, no middle-dot meta.

**Transcript:** Last few turns by default, with a fade on the leading edge. `View full conversation` expands the thread inline. `Hide conversation` collapses it. Empty copy is `No conversation.` FAQ ideas stay under the transcript.

**One recording.** A single `CallRecording` under supporting facts. Empty and player are variants of that component, not two mounts.

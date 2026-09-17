# Call detail

**Route:** `/calls/[id]`  
**Job:** Decide and reply. The list is who plus one preview. This page is the full record.

**Inside vs outside.** Gestalt split pane: Summary left, Conversation right, stack below `lg`. Situation awareness: the stamp names the next action, not a brain id. Von Restorff: one filled verb for the current task. Fitts: that verb is full width. Progressive disclosure unwraps Want, Done, mood, and next here. Peak-end: empty transcript is `No conversation.`

**Layout:** Split pane. Summary left, transcript right. Stack only below `lg`.

**Identity once.** `h1` is the caller. If a contact file exists, that `h1` is the contact link. Phone repeats only when the title is a name. No "Open contact". No second Caller card or SID block.

**Stamp:** Same owner-language signal as Inbox (Confirm visit, Hold, Human asked). Not Job / Hold taxonomy.

**Left pane order:** identity, Summary, Visit/Hold if present, SMS if on, WhatsApp, Done/Archive, supporting facts (`dl`), recording.

**Full copy lives here.** Inbox and Contacts show one truncated preview. Want, Done, mood, and next unwrap on this page. Do not truncate the Summary card.

**Primary CTA:** One filled verb. Confirm or Done when a visit or hold is on the call (full width). Reply on WhatsApp when that is the current owner task. Brand-blue fill, white WhatsApp glyph (green-on-blue fails WCAG 1.4.11). SMS can be the filled control when WhatsApp is not the current task. Compact list icons stay in the Inbox dock.

**Visit / Hold:** Confirm or Done full width. Cancel ghost below. Reopen lives here. Save on When/Where stays ghost. Failed Save is `Could not save.` Not on the list.

**Facts:** Duration. Assist in owner language (`callResolutionLabel`). Escalated-to name if present. No brain intent ids, no Alert sent, no middle-dot meta.

**Transcript:** Empty copy is `No conversation.` FAQ ideas stay under the transcript.

**One recording.** A single `CallRecording` under supporting facts. Empty and player are variants of that component, not two mounts.

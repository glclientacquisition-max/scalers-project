# Call detail

**Route:** `/calls/[id]`  
**Layout:** Split pane. Summary left, transcript right. Stack only below `md`.

**Identity once.** `h1` is the caller. Phone repeats only when the title is a name. Contact link lives in that header. Do not add a second Caller card or SID block.

**One recording.** A single `CallRecording` under supporting facts. Empty and player are variants of that component, not two mounts.

**Left pane order:** identity, Summary, Visit/Hold if present, SMS if on, WhatsApp, Done/Archive, supporting facts (`dl`), recording.

**Full copy lives here.** Inbox and Contacts show one truncated preview. Want, Done, mood, and next unwrap on this page. Do not truncate the Summary card.

**Primary CTA:** Reply on WhatsApp when it is the current owner task. Brand-blue fill, white WhatsApp glyph (green-on-blue fails WCAG 1.4.11). Compact table icons may stay green on white. `min-h-11` or larger. SMS can be the filled control when WhatsApp is not the current task.

**Visit / Hold:** Confirm or Done full width. Cancel ghost below. Not on the list.

**Stamp:** Same owner-language signal as Inbox (Confirm visit, Hold, Human asked). Not Job / Hold taxonomy.

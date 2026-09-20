# Contacts

**Route:** `/contacts`  
**Job:** Named callers. Not a CRM.

**Filters:** Same `FilterTabs` as Inbox. Do not restyle this as chips or a second tab dialect. Large in-page Contacts title (`deskListTitleClass`). No product wordmark. Import and Add sit in the lead row. Nested contact files and import do not render Contacts as a page title.

**Row:** Same recipe as Inbox. Tap the row to open the contact. No Open column. Last reason is one truncated line (`deskPreviewClass`). Phone stays in the `md+` table; phone list rows are name plus that preview. The four-block summary lives on the person file and the call.

**Detail:** `/contacts/[id]`. Notes left. Timeline right. Tap a timeline row that has a call to open the conversation. No Call column. If a phone exists, Call + WhatsApp sit in one `deskHitClass` dock under the name (`ContactActionDock`, same hits as the ticket dock). Bare-profile WhatsApp is `wa.me` only. No `callId`, no `lead_status` write-back. Empty or junk name shows **Name this caller** plus Save (`updateContactName` on the existing contacts owner update). After Save the file is Saved and the route stays. Timeline What is one truncated line (`deskPreviewClass`); tap the cell to expand detail. `DeskBack` is an icon-only chevron. `aria-label` is Contacts, or Call when opened from a conversation.

Identity is tenant + E.164 phone. The fifth call from the same number is the same contact. Last contact is the newest call. Last reason is the same hangup one-liner Inbox uses for that call. The Want card on the person file is the four-block summary, not the list line.

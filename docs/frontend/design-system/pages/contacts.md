# Contacts

**Route:** `/contacts`  
**Job:** Named callers. Not a CRM.

**Chrome:** Large in-page Contacts title (`deskListTitleClass`). No product wordmark. Search field (`ContactsSearch`, `type="search"`, Name or number) in the lead row with Import and Add. Sort is underline `FilterTabs`: Recent / Name. Nested Recent calls and Unsaved use `DeskBack` plus a compact title. Nested contact files and import do not render Contacts as a page title.

**Quick rows:** On All with no search, Recent calls and Unsaved sit above the people rows in the same list region. Not Invite Friends. Not chips. Tap opens that pile. Hide them on a pile or while searching.

**Row:** Same recipe as Inbox. Avatar, name, one honest last-reason line (`deskPreviewClass`). Tap the row to open the contact. No Open column. Phone stays in the `md+` table; phone list rows are name plus that preview. If a phone exists, Call + WhatsApp sit in the trailing `deskHitClass` dock (`CallLink` + `WhatsAppLink` icon, opened only). No `callId`. No `lead_status` write-back. No Online, presence, or live badges. The four-block summary lives on the person file and the call.

**Detail:** `/contacts/[id]`. Notes left. Timeline right. Tap a timeline row that has a call to open the conversation. No Call column. If a phone exists, Call + WhatsApp sit in one `deskHitClass` dock under the name (`ContactActionDock`, same hits as the ticket dock). Bare-profile WhatsApp is `wa.me` only. No `callId`, no `lead_status` write-back. Empty or junk name shows **Name this caller** plus Save (`updateContactName` on the existing contacts owner update). After Save the file is Saved and the route stays. Timeline What is one truncated line (`deskPreviewClass`); tap the cell to expand detail. `DeskBack` is an icon-only chevron. `aria-label` is Contacts, or Call when opened from a conversation.

**Do not:** ship a contact activity strip. Invent Online. Add Invite Friends. Write `lead_status` from the list.

Identity is tenant + E.164 phone. The fifth call from the same number is the same contact. Last contact is the newest call. Last reason is the same hangup one-liner Inbox uses for that call. The Want card on the person file is the four-block summary, not the list line.

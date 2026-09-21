# Contacts

**Route:** `/contacts`  
**Job:** Named callers. Not a CRM.

**Chrome:** Large in-page Contacts title (`deskListTitleClass`). No product wordmark. Search field (`ContactsSearch`, `type="search"`, Name or number) in the lead row. Import and Add wrap under search below `md`, sit on the lead row from `md`. Sort is underline `FilterTabs`: Recent / Name. Nested Recent calls and Unsaved use `DeskBack` plus a compact title. Nested contact files and import do not render Contacts as a page title.

**One family:** Phone (`< md`) is the list row. `md+` is one table. `lg+` is the same table with a Phone column. No third card layout. Hits stay `min-h-11` / `deskHitClass` (`h-12 w-12`). Phone `main` already clears `--desk-tabbar-clearance` (tab bar plus safe area).

**Quick rows:** On All with no search, Recent calls and Unsaved sit above the people rows in the same list region. Not Invite Friends. Not chips. Tap opens that pile. Hide them on a pile or while searching.

**Row:** Same recipe as Inbox. Avatar, name, one factual subline (`contactListSubline`: Unsaved, phone, or last call). Last call time sits with the timestamp, never "last seen" or "active now". Tap the row to open the contact. No Open column. Phone column from `lg`. If a phone exists, Call + WhatsApp sit in the trailing `deskHitClass` dock (`CallLink` `tel:` + `WhatsAppLink` `wa.me`, opened only). No `callId`. No `lead_status` write-back. No delivered claims. No Online, last seen, presence dots, or live badges. Hangup Want and the four-block summary live on the person file and the call.

**Ticket strip:** `/calls/[id]` header uses `ContactStrip` in this same family (avatar, one fact, Call + WhatsApp). Allowed facts: Unsaved, phone, last call, call/WA opened stamp. Reach is `opened` only (`tel:` / `wa.me`). No `lead_status` or Needs you invent. No Meta theater. List Phase 1 chrome stays on `/contacts`. Do not restyle the list to match the ticket, or the ticket to invent a second row language.

**Detail:** `/contacts/[id]`. Notes left. Timeline right. Tap a timeline row that has a call to open the conversation. No Call column. If a phone exists, Call + WhatsApp sit in one `deskHitClass` dock under the name (`ContactActionDock`, same hits as the ticket dock). Bare-profile WhatsApp is `wa.me` only. No `callId`, no `lead_status` write-back. Empty or junk name shows **Name this caller** plus Save (`updateContactName` on the existing contacts owner update). After Save the file is Saved and the route stays. Timeline What is one truncated line (`deskPreviewClass`); tap the cell to expand detail. `DeskBack` is an icon-only chevron. `aria-label` is Contacts, or Call when opened from a conversation. Tap identity on a ticket `ContactStrip` opens this file.

**Do not:** ship a contact activity strip. Invent Online, last seen, presence dots, or active now. Add Invite Friends. Write `lead_status` from the list. Claim delivered from a list tap.

Identity is tenant + E.164 phone. The fifth call from the same number is the same contact. Last call on the list is the newest call or work stamp. Last reason on the person file is the same hangup one-liner Inbox uses for that call. The Want card on the person file is the four-block summary, not the list line.

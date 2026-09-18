# Inbox

**Route:** `/calls`  
**Job:** One work surface. Brain intent ids are mapped onto owner stamps. Copy follows `tenants.vertical`.

**Outside vs inside.** `/calls` is recognition. `/calls/[id]` is decision. Jakob: who plus one ellipsized preview, like Mail or WhatsApp. Progressive disclosure: hangup copy stays on the record. Working memory: four chunks on a row (who, work, stamp or time, one verb). Von Restorff: that verb is the only fill. Hick: Holds and Visits change columns; they do not grow a second list. Fitts: the dock is `h-12 w-12`. Tesler: Brain taxonomy stays off the row.

Retail: Pickup / Order / Holds. Home services: Confirm visit / Visits. Hospitality: Confirm booking / Bookings.

**Chrome:** Title Inbox. Caption briefing. Search placeholder matches the niche.

**Row (one recipe):** iOS Mail + Material list + WhatsApp. Who first. Work second. Stamp or time as meta. Trailing slot holds **one** primary verb. Tap the row (name, work, stamp, time) to open the conversation. No Open or View link. On `md+` that conversation opens beside this list. Phone is still a full call.

**Phone mixed:** Who left, time right, one work preview. No stamp chip under the preview. Stamp lives in the table Needed column. The same Mail row is the list chrome when a call is open on `md+`.

**Phone Holds / Visits:** Same two-line row. Isolated Place or hold-type is a table column, not a third phone line.

**Preview (one line):** Work is `deskPreviewClass`. One ellipsized line. The hangup paragraph, Want, Done, mood, and next live on `/calls/[id]`. Do not stack a second detail line under Work on mixed filters. Table Work cells use `deskPreviewCellClass`. Phone uses the same one-line clamp, never `line-clamp-2` for the summary. Isolated Holds and Visits table cells are also one line (Item or slot, not a stacked subtype).

**Action dock (that trailing cell):**
- Visit or booking with a job row: **Confirm** (then Done). That verb only.
- Hold or order with a request row: **Done**. That verb only. Reopen lives on the call, never beside Done on the list.
- Return call, missed, or human asked, with a dialable number: **Call** then **WhatsApp**. Call is `tel:` on the device dialer. WhatsApp is `wa.me` with the follow-up opener.
- No number: empty.
- Not in this cell: Open, View, Send SMS, email, Archive. SMS stays on the call when Text customers is on.

Stamp matches the verb on that row. **Confirm visit** only when an appointments row exists (verb Confirm). Intent-only visits stamp **Return call** and use WhatsApp. Same for holds without a request row.

**Reply vs Confirm (not the same button):**
- **Confirm:** Books the visit from the list or the call. If Business → Text customers is on, Scalers SMS them the confirmation. That SMS is automatic. It is not a second list button.
- **WhatsApp:** Opens chat. List verb for return calls. On the call, primary only when there is no visit/hold and Text customers is off.
- **Send SMS:** Write a text on the call, then send. Shows only if Text customers is on. Primary on the call when there is no visit/hold to Confirm or Done. Not a list verb (needs a body).

Filters: Needs you / All / Visits or Bookings / Holds or niche hold label / Human / Answered. Same `FilterTabs` as Contacts. Quiet hairline groups: act (Needs you, All), book (Visits, Holds), closed (Human, Answered).

**Visit sort:** When Visits is isolated, List / Work is a second `FilterTabs` row (underline, not filled). Visit sort uses FilterTabs so Confirm stays the only filled verb. List is the Inbox table: requested and confirmed, newest work. Work is the diary of that same book. Date is visible there. Confirm lives on List and on Work.

**Work date:** Today / Week appears only under Work. Today is this EAT day by clock, with the day heading and slot time. Requested slots for that day sit here. Week is the same book by day. Phone shows only days with work. Desktop keeps the seven-day grid. Prev / Next moves the day or week. Holds stay on Holds. Done and cancelled stay off this book.

**Hold sort:** When Holds is isolated, List / Work is a second `FilterTabs` row. List is newest open holds. Pickup, order, and enquiry sit together. Anytime stays on List. Work is this EAT day by pickup clock. Open holds whose slot is today sit here. You Done there. No week grid.

**Bar order (owner characters):**
- **08:00 owner:** Needs you first. What still needs a decision.
- **Live watcher:** All second. Newest tape, one hop from Needs you. Hangup stays here.
- **Visit confirmer:** Visits before Holds. Home services money book. Retail still has Holds next to it.
- **Closed:** Human then Answered. Missed and finished sit after the tape, not between work and All.

**Piles (one question each):**
- **Needs you:** Open work. A decision is still on you. Unconfirmed visits, open holds, return calls, human asked. Confirmed visits leave this pile.
- **All:** Everything, including Done. Newest first.
- **Visits / Bookings:** The live book. Requested (still to confirm) and confirmed (booked). After Confirm the row stays here, not in Needs you. Done and cancelled leave the book.
- **Holds:** Open items to fulfill. Fulfilled and cancelled leave this pile.
- **Human:** Person asked or missed.
- **Answered:** The receptionist closed it. No owner action.

Needs you is not a history. Older open work stays until you Confirm, Done, or reply.

**Live tape (one row, never a vanishing act):**
1. **Insert.** The call row appears at the top of All, stamp **Live**. Needs you also shows it while it is on the line.
2. **Talking.** The same row stays. Name or reason may fill in. Stamp stays Live.
3. **Hangup.** The same row stays at the top of All. Stamp becomes the outcome: Live becomes Missed, Human asked, Confirm visit, Hold, or Answered.
4. **Needs you.** Missed, Human asked, unconfirmed visits, and open holds stay. Answered leaves Needs you and sits on Answered. It does not leave All, and it does not drop under a backlog of old visits.
5. **Debounce.** Insert plus hangup within 1.2s collapse to one refresh. A short call may only show the final stamp. A longer call shows Live, then the hangup stamp on the same row.

All is newest first. No visit backlog, no urgent pin. Needs you still pins urgent, then newest open work. Confirm visit, Holds, and Visits filters still isolate that book.

`hold_or_pickup` and `order_enquiry` are Holds. `product_inquiry` is Answered, not Needs you.

**Live subscribe:** `LiveInbox` mounts once in the desk shell and stays subscribed on Settings, a call, and every other desk route. It waits for an owner JWT, then listens to `calls` / `service_requests` / `appointments` for the tenant (Supabase Realtime, member RLS governs what an owner receives). After a 1.2s debounce it `revalidatePath`s `/calls` and `/home` and re-runs the current page. Coming back to the tab also refetches. Without the publication, replica identity FULL, or an owner session the page stays refresh-to-update.

Columns (`md+` table, same data as the phone row):
- Mixed filters: Work / Needed / When / Action.
- Holds: Item / Who / Needed. Verb **Done**.
- Jobs: Visit or Booking / Who / Place. Verb **Confirm**.

**Icons (Inbox only):**
- WhatsApp glyph, green on white, `h-12 w-12`, `rounded-xl`. Only when WhatsApp is the row verb (return call).
- Call glyph (`CallLink`): rounded handset in brand blue, light accent wash, `h-12 w-12`. Sits left of WhatsApp. Never a filled primary. Never a desk-telephone silhouette.
- No icon pack. No decorative row icons. Stamps stay words (Confirm visit, Pickup, Human asked).
- Confirm / Done / Call / WhatsApp are `h-12 w-12`. List: that verb only. Call detail uses the same hit. Transcript is the right pane from `xl`; stack below `xl`.

**Errors:** Failed Confirm or Done shows "Could not save." under the button. Do not log that as the owner UI.

**Back:** `DeskBack`, 44px. Label is Inbox. Returns to the same pile, search, page, and visit layout (List / Today / Week).

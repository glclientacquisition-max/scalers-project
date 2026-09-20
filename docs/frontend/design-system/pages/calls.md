# Inbox

**Route:** `/calls`  
**Job:** One work surface. Brain intent ids are mapped onto owner stamps. Copy follows `tenants.vertical`.

**Outside vs inside.** `/calls` is recognition. `/calls/[id]` is decision. Jakob: who plus one ellipsized preview, like Mail or WhatsApp. Progressive disclosure: hangup copy stays on the record. Working memory: four chunks on a row (who, work, stamp or time, one verb). Needs you may restate that verb as one muted next-step line. Von Restorff: that verb is the only fill. Hick: Holds and Visits change columns; they do not grow a second list. Fitts: the dock is `h-12 w-12`. Tesler: Brain taxonomy stays off the row.

Retail: Pickup / Order / Holds. Home services: Confirm visit / Visits. Hospitality: Confirm visit / Bookings until reservations exist. Confirm booking stays gated.

**Chrome:** Large in-page Inbox title (`deskListTitleClass`). Not sticky. No product wordmark. Needs you count overlays the Inbox nav icon (`formatAttentionCount`, `9+` at 10, ribbon `from-accent to-accent-fill`). Search, then purpose pills. Nested Archived keeps its compact title. Nested tickets do not render Inbox as a page title. Search placeholder matches the niche.

**Row (one recipe):** iOS Mail + Material list + WhatsApp. Who first. Work second. Stamp or time as meta. Trailing slot holds **one** primary verb. Tap the row (name, work, stamp, time) to open the conversation. Tap the identity circle to open the contact. No Open or View link. Blue unread dot and bold preview when a customer event (inbound call, hold, or visit from the caller) is newer than `calls.inbox_read_at`. Opening `/calls/[id]` stamps that field. Needs you stays a pile. The nav badge stays Needs you count (`countInboxPurposes(items).needs`). Confirm, hold Done, Mark done, and Archive drop the badge, not the open.

**Phone mixed:** Who left, time right, one work preview. No stamp chip under the preview. Stamp lives in the table Needed column. Needs you may add one next-step line under Work.

**Phone Holds / Visits:** Same two-line row. Isolated Place or hold-type is a table column, not a third phone line. Needs you may still add the next-step line.

**Preview (one line):** Work is `deskPreviewClass`. One ellipsized line. The hangup paragraph, Want, Done, mood, and next live on `/calls/[id]`. Do not stack a second detail line under Work on mixed filters. Table Work cells use `deskPreviewCellClass`. Phone uses the same one-line clamp, never `line-clamp-2` for the summary. Isolated Holds and Visits table cells are also one line (Item or slot, not a stacked subtype).

**Needs you next step:** Rows still in the Needs you pile may show one muted line under the preview (`inboxNeedsYouNextStep`). It restates `inboxListDockRecipe` in words: Confirm visit, Hold Done, or Call or WhatsApp. Hospitality Confirm booking stays gated until reservations exist. Intent-only never uses Confirm or Done language. Live and empty docks omit the line. Not hangup copy. Not a second button.

**Action dock (that trailing cell):**
- Visit or booking with a job row: **Confirm** (then Done). That verb only.
- Hold or order with a request row: **Done**. That verb only. Reopen lives on the call, never beside Done on the list.
- Return call, missed, or human asked, with a dialable number: **Call** then **WhatsApp**. Call is `tel:` on the device dialer. WhatsApp is `wa.me` with the follow-up opener.
- No number: empty.
- Not in this cell: Open, View, Send SMS, email, Archive. SMS stays on the call when Text customers is on.

**Overflow (md+ More, right-click):** Pin / Unpin. Mark done on a return call (`inboxCanMarkDone`). Archive on live rows. Unarchive on Archived. Hairline between stay and leave. No Select (checkboxes are already visible). Never Snooze or Unread. Hover More on desktop. More is `hidden md:inline-flex`. Long-press on phone enters bulk select. It does not open a contact-named sheet. The dock stays Confirm, Done, or Call plus WhatsApp. More sits left of that dock. The desktop menu right-aligns to More and flips up in a short viewport so it never covers Call or WhatsApp.

Not list verbs: Select, Snooze, Mute, Assign, Label, Delete, Mark unread. Bulk header bar: Close, count, then only verbs true for every selected row. Archive if none are archived. Unarchive if all are archived. Confirm if every row is a requested visit. Hold Done if every row is an open hold. Mark done if every row passes `inboxCanMarkDone`. Pin stays on the row overflow. Mixed selection can show only Close. Archive also shows that Undo toast. No More sheet on the bulk bar.

Stamp matches the verb on that row. **Confirm visit** only when an appointments row exists (verb Confirm). Intent-only visits stamp **Visit not booked** and use Call plus WhatsApp. Hospitality **Confirm booking** / **Booking not booked** stay behind `HOSPITALITY_RESERVATIONS_EXIST`. Intent-only holds stamp **Hold not saved**. Do not show Confirm or Done without a work row.

**Reply vs Confirm (not the same button):**
- **Confirm:** Books the visit from the list or the call. If Business → Text customers is on, Scalers SMS them the confirmation. That SMS is automatic. It is not a second list button.
- **Done:** Fulfills the hold from the list or the call. If Text customers is on, Scalers SMS them that the item is ready. Enquiry and callback stay silent. Cancel on the call texts that the pickup is cancelled.
- **WhatsApp:** Opens chat. List verb for return calls. On the call, primary only when there is no visit/hold and Text customers is off.
- **Send SMS:** Write a text on the call, then send. Shows only if Text customers is on. Primary on the call when there is no visit/hold to Confirm or Done. Not a list verb (needs a body).

Filters: Needs you / All / Visits or Bookings / Holds or niche hold label / Human / Answered. That six-item row is `InboxFilterPills`: self-contained rounded chips, count inside the chip, horizontal scroll-snap, trailing fade. Selected is a filled chip, not an underline. List / Work and Today / Week stay underline `FilterTabs`. Archived is not a chip. On touch, a dominant horizontal swipe on the thread list (not the shell, not the chips) moves one pile along that same order. The list follows the finger (capped), then finishes the slide. The next pile paints from the All-tape cache (`itemMatchesPurpose`) immediately. `router.replace` syncs `purpose=` in the background. Adjacent piles prefetch. Pending spinner only if that pile has no cached rows. Archived is not a swipe stop. Mouse and trackpad use chips only. Bulk select turns the gesture off.

**Visit sort:** When Visits is isolated, List / Work is a second `FilterTabs` row (underline, not filled). List is the Inbox table: requested and confirmed, newest first. Confirmed visits whose week has already ended pin at the top of List, oldest slot first. Confirm lives on List. Work is confirmed only, by clock. Work's verb is Done.

**Work date:** Today / Week appears only under Work. Today is this EAT day by clock, with the day heading and slot time. Confirmed slots for that day sit here. Requested visits stay on List until Confirm. Week is the same confirmed book by day. A past day this week still sits on that weekday. Last week's open confirmed visits sit on List, not on Today. Phone shows only days with work. Desktop keeps the seven-day grid. Prev / Next moves the day or week. Holds stay on Holds. Done and cancelled stay off this book.

**Hold sort:** When Holds is isolated, List / Work is a second `FilterTabs` row. List is newest open holds. Pickup, order, and enquiry sit together. Anytime stays on List. Timed open holds whose day has already ended pin at the top of List, oldest slot first. Work is timed pickups for this EAT day only. You Done there. No week grid.

**Bar order (owner characters):**
- **08:00 owner:** Needs you first. What still needs a decision.
- **Live watcher:** All second. Newest tape, one hop from Needs you. Hangup stays here.
- **Visit confirmer:** Visits before Holds. Home services money book. Retail still has Holds next to it.
- **Closed:** Human then Answered. Missed and finished sit after the tape, not between work and All.

**Piles (one question each):**
- **Needs you:** Open work. A decision is still on you. Unconfirmed visits, open holds, return calls, human asked, product inquiries with no sale or booking, and visits/holds the receptionist named but did not persist. Confirmed visits leave this pile. This pile is complete: every open hold and every requested or confirmed visit is loaded, even if older than the call tape.
- **All:** Everything, including Done. Newest first.
- **Visits / Bookings:** The live book. Requested (still to confirm) and confirmed (booked). After Confirm the row stays here, not in Needs you. Done and cancelled leave the book.
- **Holds:** Open items to fulfill. Fulfilled and cancelled leave this pile.
- **Human:** Person asked or missed.
- **Answered:** The receptionist closed it. No owner action.
- **Archived:** WhatsApp folder. A row at the top of the list (phone, tablet, desktop) with the archive glyph, Archived, and the count. Tap it. Not a FilterTabs chip. Inside: icon `DeskBack` (aria-label Inbox), title Archived, same list recipe. Overflow is Pin plus Unarchive. Confirm and hold Done stay off the dock. Call plus WhatsApp stay if there is a number.

Needs you is not a history. Older open work stays until you Confirm, Done, or reply. The Inbox tape of recent calls is 150 rows. Open holds (`status = open`) and unresolved visits (`requested`, `confirmed`) are fetched without that cap (safety stop 10,000, using `service_requests_tenant_status_idx` and `appointments_tenant_status_idx`). `callsTruncated` means the closed history tape is truncated, not that Needs you, Holds, or Visits is missing rows.

**Live tape (one row, never a vanishing act):**
1. **Insert.** The call row appears at the top of All, stamp **Live**. Needs you also shows it while it is on the line.
2. **Talking.** The same row stays. Name or reason may fill in. Stamp stays Live.
3. **Hangup.** The same row stays at the top of All. Stamp becomes the outcome: Live becomes Missed, Human asked, Confirm visit, Hold, or Answered.
4. **Needs you.** Missed, Human asked, unconfirmed visits, and open holds stay. Answered leaves Needs you and sits on Answered. It does not leave All, and it does not drop under a backlog of old visits.
5. **Debounce.** Insert plus hangup within 1.2s collapse to one refresh. A short call may only show the final stamp. A longer call shows Live, then the hangup stamp on the same row.

All is newest first. No visit backlog, no urgent pin. Needs you still pins urgent, then newest open work. Confirm visit, Holds, and Visits filters still isolate that book.

`hold_or_pickup` and `order_enquiry` are Holds. Bare `product_inquiry` with no attached visit or hold is an active lead on Needs you, not Answered. An attached appointment is a booking and wins as a visit.

**Live subscribe:** `LiveInbox` mounts once in the desk shell and stays subscribed on Settings, a call, and every other desk route. It waits for an owner JWT, then listens to `calls` / `service_requests` / `appointments` for the tenant (Supabase Realtime, member RLS governs what an owner receives). After a 1.2s debounce it `revalidatePath`s `/calls` and `/home` and re-runs the current page. Coming back to the tab also refetches. Without the publication, replica identity FULL, or an owner session the page stays refresh-to-update.

Columns (`lg+` table, same data as the phone row; phone rows stay through `md` so the Action dock is not clipped):
- Mixed filters: Work / Needed / When / Action.
- Holds: Item / Who / Needed. Verb **Done**.
- Jobs: Visit or Booking / Who / Place. Verb **Confirm**.

**Icons (Inbox only):**
- WhatsApp glyph, green on white, `h-12 w-12`, `rounded-xl`. Only when WhatsApp is the row verb (return call).
- Call glyph (`CallLink`): rounded handset in brand blue, light accent wash, `h-12 w-12`. Sits left of WhatsApp. Never a filled primary. Never a desk-telephone silhouette.
- No icon pack. No decorative row icons. Stamps stay words (Confirm visit, Pickup, Human asked).
- Confirm / Done / Call / WhatsApp are `h-12 w-12`. List: that verb only. Call detail uses the same hit on the ticket action dock (Mark done, Call, WhatsApp, Ping). Transcript is the right pane from `lg`; stack below `lg`. Icon-only Call, WhatsApp, More, Back, Polish, and Send name themselves on hover (`DeskHint`).

**Errors:** Failed Confirm or Done shows "Could not save." under the button. Do not log that as the owner UI.

**Back:** `DeskBack`, icon-only chevron, 44px muted ghost. `aria-label` / `title` is Inbox. No visible "Inbox" or "Back to Inbox". Returns to the same pile, search, page, and visit layout (List / Today / Week). Archived stores that return on the folder link (`from`, `rpage`, view params) so DeskBack restores it, not only `q`.

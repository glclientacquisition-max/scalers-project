# Inbox

**Route:** `/calls`  
**Job:** One work surface. Brain intent ids are mapped onto owner stamps. Copy follows `tenants.vertical`.

Retail: Pickup / Order / Holds. Home services: Confirm visit / Visits. Hospitality: Confirm booking / Bookings.

**Chrome:** Title Inbox. Caption briefing. Search placeholder matches the niche.

**Row (one recipe):** iOS Mail + Material list + WhatsApp. Who first. Work second. Stamp or time as meta. Trailing slot holds **one** primary verb. Tap the row (name, work, stamp, time) to open the conversation. Confirm / Done / WhatsApp stay the only verbs. A muted Call icon sits left of WhatsApp when the row has a number and no visit/hold verb. No Open or View link.

Stamp matches the verb on that row. **Confirm visit** only when an appointments row exists (verb Confirm). Intent-only visits stamp **Return call** and use WhatsApp. Same for holds without a request row.

**Reply vs Confirm (not the same button):**
- **Confirm:** Books the visit from the list or the call. If Business → Text customers is on, Scalers SMS them the confirmation. That SMS is automatic. It is not a second list button.
- **WhatsApp:** Opens chat. List verb for return calls. On the call, primary only when there is no visit/hold and Text customers is off.
- **Send SMS:** Write a text on the call, then send. Shows only if Text customers is on. Primary on the call when there is no visit/hold to Confirm or Done. Not a list verb (needs a body).

Filters: Needs you / Holds or niche hold label / Visits, Jobs, or Bookings / Human / Answered / All. Same `FilterTabs` as Contacts.

**Piles (one question each):**
- **Needs you:** Open work. A decision is still on you. Unconfirmed visits, open holds, return calls, human asked. Confirmed visits leave this pile.
- **Visits / Bookings:** The live book. Requested (still to confirm) and confirmed (booked). After Confirm the row stays here, not in Needs you. Done and cancelled leave the book.
- **Holds:** Open items to fulfill. Fulfilled and cancelled leave this pile.
- **Human:** Person asked or missed.
- **Answered:** The receptionist closed it. No owner action.
- **All:** Everything, including Done.

Needs you is not a history. Older open work stays until you Confirm, Done, or reply.

Work that needs the owner sorts above answered rows. Urgent first. Then newest first, same as Contacts. A call that just landed is row 1 of Needs you, not under weeks of unconfirmed visits. Confirm visit, Holds, and Visits filters still isolate that book.

**Live:** rows appear as calls land. `LiveInbox` mounts once in the desk shell and stays subscribed on Settings, a call, and every other desk route. It waits for an owner JWT, then listens to `calls` / `service_requests` / `appointments` for the tenant (Supabase Realtime, member RLS governs what an owner receives). After a 1.2s debounce it `revalidatePath`s `/calls` and `/home` and re-runs the current page, so one call's insert plus hangup collapse into a single refresh and Inbox is not stale when the owner returns to it. Coming back to the tab also refetches. Without the publication, replica identity FULL, or an owner session the page stays refresh-to-update.

`hold_or_pickup` and `order_enquiry` are Holds. `product_inquiry` is Answered, not Needs you.

Columns (`md+` table, same data as the phone row):
- Mixed filters: Work / Needed / When / Action.
- Holds: Item / Who / Needed. Verb **Done**.
- Jobs: Visit or Booking / Who / Place. Verb **Confirm**.

**Icons (Inbox only):**
- WhatsApp glyph, green on white, `h-11 w-11`, `rounded-xl`. Only when WhatsApp is the row verb (return call).
- Call glyph (`CallLink`, `tel:` deep link; the device dialer places the call). Muted bordered `h-11 w-11`, sits left of WhatsApp. Never a filled button.
- No icon pack. No decorative row icons. Stamps stay words (Confirm visit, Pickup, Human asked).
- Confirm / Done are text on `#005CCC`, 44px. List: that verb only. Call: Confirm or Done on top, Cancel ghost below. Transcript is the right pane.

**Errors:** Failed Confirm or Done shows "Could not save." under the button. Do not log that as the owner UI.

`/requests` → `?purpose=hold`. `/appointments` → `?purpose=job`.

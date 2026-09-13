# Inbox

**Route:** `/calls`  
**Job:** One work surface. Brain intent ids are mapped onto owner stamps. Copy follows `tenants.vertical`.

Retail: Pickup / Order / Holds. Home services: Confirm visit / Visits. Hospitality: Confirm booking / Bookings.

**Chrome:** Title Inbox. Caption briefing. Search placeholder matches the niche.

**Row (one recipe):** iOS Mail + Material list + WhatsApp. Who first. Work second. Stamp or time as meta. Trailing slot holds **one** primary verb. Phone: the text block opens the call. Desktop: work lines and Call/Open open the call. Name opens the contact.

Stamp matches the verb on that row. **Confirm visit** only when an appointments row exists (verb Confirm). Intent-only visits stamp **Return call** and use WhatsApp. Same for holds without a request row.

**Reply vs Confirm (not the same button):**
- **Confirm:** Books the visit from the list or the call. If Business → Text customers is on, Scalers SMS them the confirmation. That SMS is automatic. It is not a second list button.
- **WhatsApp:** Opens chat. List verb for return calls. On the call, primary only when there is no visit/hold and Text customers is off.
- **Send SMS:** Write a text on the call, then send. Shows only if Text customers is on. Primary on the call when there is no visit/hold to Confirm or Done. Not a list verb (needs a body).

Filters: Needs you / Holds or niche hold label / Visits, Jobs, or Bookings / Human / Answered / All.

Work that needs the owner sorts above answered rows. Visits before holds. Urgent first.

`hold_or_pickup` and `order_enquiry` are Holds. `product_inquiry` is Answered, not Needs you.

Columns (`md+` table, same data as the phone row):
- Mixed filters: Work / Needed / When / Action.
- Holds: Item / Who / Needed. Verb **Done**. Transcript is **Call**.
- Jobs: Visit or Booking / Who / Place. Verb **Confirm**. Transcript is **Call**.

**Icons (Inbox only):**
- WhatsApp glyph, green on white, `h-11 w-11`, `rounded-xl`. Only when WhatsApp is the row verb (return call).
- No icon pack. No decorative row icons. Stamps stay words (Confirm visit, Pickup, Human asked).
- Confirm / Done are text on `#005CCC`, 44px. List: that verb only. Call: Confirm or Done on top, Cancel ghost below. Transcript is the right pane.

**Errors:** Failed Confirm or Done shows "Could not save." under the button. Do not log that as the owner UI.

`/requests` → `?purpose=hold`. `/appointments` → `?purpose=job`.

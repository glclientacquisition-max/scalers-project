# Inbox

**Route:** `/calls`  
**Job:** One work surface. Brain intent ids are mapped onto owner stamps. Copy follows `tenants.vertical`.

Retail: Pickup / Order / Holds. Home services: Confirm visit / Visits. Hospitality: Confirm booking / Bookings.

**Chrome:** Title Inbox. Caption briefing. Search placeholder matches the niche.

**Row (one recipe):** iOS Mail + Material list + WhatsApp. Who first. Work second. Stamp or time as meta. Trailing slot holds **one** primary verb. Phone: the text block opens the call. Desktop: Call or Open stays a trailing text link.

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
- Confirm / Done are text on `#0096FF`, 44px. Cancel lives on the call, not in the list.

**Errors:** Failed Confirm or Done shows "Could not save." under the button. Do not log that as the owner UI.

`/requests` → `?purpose=hold`. `/appointments` → `?purpose=job`.

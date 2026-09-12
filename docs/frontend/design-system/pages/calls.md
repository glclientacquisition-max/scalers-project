# Inbox

**Route:** `/calls`  
**Job:** One work surface. Brain intent ids are mapped onto owner stamps. Copy follows `tenants.vertical`.

Retail: Pickup / Order / Holds. Home services: Confirm visit / Visits. Hospitality: Confirm booking / Bookings.

**Chrome:** Title Inbox. Caption briefing. Search placeholder matches the niche. Below `md`, each row is a dense stacked block in the same table chrome (not cards). `md+` stays the table.

Filters: Needs you / Holds or niche hold label / Visits, Jobs, or Bookings / Human / Answered / All.

Work that needs the owner sorts above answered rows. Visits before holds. Urgent first.

`hold_or_pickup` and `order_enquiry` are Holds. `product_inquiry` is Answered, not Needs you.

Columns:
- Mixed filters: Work / Needed / When / Action.
- Holds: Item / Who / Needed. Verb **Done**. Transcript is **Call**.
- Jobs: Visit or Booking / Who / Place. Verb **Confirm**. Transcript is **Call**.

`/requests` → `?purpose=hold`. `/appointments` → `?purpose=job`.

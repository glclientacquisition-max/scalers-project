# Appointments `/appointments`

**Job:** Manage visit bookings.  
**Visual:** Same as Calls. Current page is not a source.

See [`MASTER.md`](../MASTER.md) and [`calls.md`](./calls.md).

## Now (do not copy)

Double padding (`px-4 py-10` inside desk main), fluff subtitle, em dash in the row title, chip filters, cards, “Related calls” → `/calls`.

## Phase 4

- Drop extra page gutter; use the shell only
- Toolbar + table (When, Caller, Service, When/Where, Status)
- `AppointmentStatusToggle` stays the domain control
- Related call: `/calls/{id}` when `call_id` exists
- Copy: no subtitle, no em dash
- Empty: Calls recipe. Do not teach vertical setup in a paragraph

Do not change appointment schema or home-services playbooks.

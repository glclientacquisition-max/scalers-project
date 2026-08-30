# Requests `/requests`

**Job:** Process service requests.  
**Visual:** Calls collection pattern.

See [`MASTER.md`](../MASTER.md) and [`calls.md`](./calls.md).

## Now (Phase 4)

Title + status tabs with tenant-wide head counts (scoped by type when a type is selected). Type as a second tab row (domain filter, same visual language). Dense table on `md+`; compact divided rows below. Pagination at 25. Empty: Calls recipe. Errors do not mention SQL. WhatsApp stays a channel glyph on the number. Open goes to `/calls/{id}` when `call_id` exists. `RequestStatusToggle` kept as the domain control.

Search is not offered. The list query has no search parameter; a search field would imply a capability that does not exist.

## Later

Do not add request rows to Home until product asks. Do not change request RPCs or statuses.

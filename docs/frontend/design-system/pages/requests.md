# Requests `/requests`

**Job:** Process service requests.  
**Visual:** Become the Calls collection pattern. Do not keep stacked cards.

See [`MASTER.md`](../MASTER.md) and [`calls.md`](./calls.md).

## Now

Two tab rows (status, type), Open count from **current rows**, `<ul>` of padded cards, WhatsApp + Open call.

## Phase 4

- One toolbar: status tabs with **tenant-wide** counts (head queries like Calls), optional type filter
- Table columns aligned to the domain: When, Caller, Type, Item, Status, Open
- Reuse `Pagination` if the query is ranged; today `limit(100)` is acceptable until it hurts
- Empty: Calls empty recipe, no subtitle essay
- Primary row action stays WhatsApp / Open call; status via `RequestStatusToggle` (keep domain behavior)

Do not change request RPCs or statuses. Ops/Brain own those.

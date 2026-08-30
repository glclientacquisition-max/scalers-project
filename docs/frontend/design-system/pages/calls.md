# Calls `/calls`

**Job:** Review and act on call activity.  
**This page is the collection benchmark.** Do not redesign it for Frontend 2.0.

See [`MASTER.md`](../MASTER.md) §§6.1–6.4.

## Why it works

- Title + search, then status tabs with counts
- One table, inline status / Done / Archive, Open
- Horizontal scroll on small screens, not card conversion
- Empty states are short and specific
- Pagination reused from `Pagination.tsx`

## Allowed later fixes (not a redesign)

- Empty-state hrefs: `?tab=train` and `?tab=test` (not `#`)
- Title “Inbox” vs nav “Calls”: leave unless product asks
- Search field may pick up `settingsFieldClass` focus in Phase 5

Preserve filters, `toLead`, WhatsApp on the number, muted icon Done/Archive.

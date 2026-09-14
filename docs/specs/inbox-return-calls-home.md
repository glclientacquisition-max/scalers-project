# Inbox: a honest home for return calls

**Status:** Proposed. Found during the Home desktop review 2026-09-14.
**Lane:** Desk UI/UX
**Authority:** [`FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md) and [`calls.md`](../frontend/design-system/pages/calls.md) outrank this spec.

---

## Problem

Three small mismatches around return calls, visible once the piles landed:

1. **Home's first queue counts one thing and opens another.** The row is labelled *Needs you*, counts `work.toReturn` (open items with no job or hold record), but links to `purpose=human`. The Inbox *Needs you* pile is all open work (`purpose=needs`). Same label, two meanings.
2. **Intent-only work matches no book.** A `book_visit` intent with no appointments row (or a hold intent with no request row) stamps *Return call* and appears only in *Needs you* and *All*. `itemMatchesPurpose` for `job` requires a real appointment status; for `hold` a real open request. Orphans fall through.
3. **Human is a history, the books are live.** `hold` filter is open-only, `job` filter is requested+confirmed, but `human` includes resolved and archived leads. One filter answers "still open", another answers "ever happened".

None of these block the Home desktop craft PR. They surface only when an owner compares counts across pages.

## Proposal

- Make the `human` filter live-only: `human` or `missed` purpose **and** `leadStillOpen(leadStatus)`. Resolved human work stays in *All*, same as Done visits leaving the Visits book.
- Fold intent-only orphans into the same filter: open items with no job and no hold record, regardless of purpose. That filter then counts exactly `work.toReturn`, and Home's first row can count and open the same set.
- Relabel Home's first row to the niche return label (`copy.returnCtaMany`, "Return calls") so Home names the queue and Inbox names the pile. Unit drops; the count carries the row.

## Not in this spec

- No new filter tab. Six is already the Hick ceiling.
- No change to `inboxNeedsYou` or the Needs you pile definition.
- No change to stamps. *Return call* stays the stamp for intent-only work.

## Test gate

- `tests/inboxPurpose.test.js`: human filter is live-only and includes orphans; counts match `summarizeInboxWork.toReturn`.
- `tests/homeOverviewCraft.test.js`: Home row one label, count, and href agree.

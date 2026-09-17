# Inbox universal prototype

**Status:** Design bench only. Live product remains `/calls`.  
**See:** `http://localhost:3000/dev/inbox` after `cd dashboard && npm run dev`.

## Need (multi-tenant work inbox)

The Inbox is the owner’s morning queue for every workspace niche. Callers already spoke to the receptionist. The owner must:

1. See what still needs a human in one glance.
2. Decide without opening a second mental model (no cards vs table, no second nav).
3. Act: WhatsApp, confirm a visit, mark a hold done, note a human ask.
4. Read the call next to the decision. Summary left, transcript right.
5. Use the same chrome on phone (list, then record) and desktop (list beside record).

Universal apps that do this job: Superhuman, Front, Intercom, Gmail. They share master-detail, work-first stamps, one primary verb, and muted close-out. They do not share our tokens or our no-rail desk.

This bench applies those interaction standards on Scalers tokens (`text-ink`, `bg-surface`, `border-line`, fill `#005CCC` via `accent-fill`). No shadcn variables, no left rail, no metric tiles, no Framer Motion.

## What this bench changes vs `/calls`

| Area | Live `/calls` | Prototype `/dev/inbox` |
| --- | --- | --- |
| Data | Supabase inbox assemble | Dummy morning queue |
| Desktop | Table, then `/calls/[id]` | List + record on one screen |
| Detail | Own page, split pane | Split pane in the list record |
| Phone | Stacked row → new route | Same rows → in-place record + Back |
| Actions | Server mutations | Local Done / Confirm only |
| Filters | URL `?purpose=` | In-page tabs |
| Live Inbox | Realtime | Not in this bench |

`/calls`, `InboxItemRow`, loaders, and RLS are untouched.

## Execution prompts (paste one per Desk UI chat)

Do not merge this branch into the product. When you want the real Inbox, run these on a fresh feature branch.

### Prompt 1. Master-detail on `/calls`

Stay in Desk UI/UX. Read `docs/agents/DESK_UX.md` and `.cursor/rules/scalers-design-ux.mdc`. Do not add a left desk rail, cards, or a second list layout.

Upgrade `/calls` so desktop is a side-by-side grid: inbox list left, selected record right. The record is summary left, transcript right. Phone keeps the dense row list. Tap a row opens the record in place with Back. Do not add Open or View columns.

Keep purpose filters, search, niche copy, and URL `?purpose=` / `?q=`. Selected id may be `?id=` so refresh and back from WhatsApp restore the row.

Reuse `InboxItem`, `loadInboxItems`, and existing actions. Wire Confirm / Done / WhatsApp to the same mutations as today. Do not invent dummy data in production.

Match `/dev/inbox` density and tokens. No `bg-background` / `text-muted-foreground`. No lucide. No page-wide motion.

### Prompt 2. Selected-row state

On the list, the open record uses `bg-accent-soft` and a visible `aria-current`. Needs-you rows keep the accent dot and semibold name. Urgent rows keep `bg-warn-soft` only when not selected.

### Prompt 3. Phone clearance

The in-place record must clear `--desk-tabbar-clearance`. Back is a ghost control, not a second primary. Primary remains Reply on WhatsApp (`btnPrimary` / `WhatsAppLink` variant primary). Confirm and Done stay ghost.

## Out of scope

Keyboard j/k, bulk select, snooze, assignment, CRM, analytics tiles, week calendar (already on `/calls?purpose=job&view=week`).

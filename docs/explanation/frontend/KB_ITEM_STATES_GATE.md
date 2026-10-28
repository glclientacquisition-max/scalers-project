---
owner: desk
last_reviewed: 2026-10-28
---

# Catalogue item states gate (`DESK_KB_ITEM_STATES`)

Settings › Catalogue (KB v2, `/settings/knowledge`) lets an owner set an item's **Status** to
Offered, Paused (with an optional note) or Not offered. Those two states only mean something to
callers once both of these are live in the same environment:

1. Platform's KB writers (#998, #999): onboarding, `/api/tenant` and imports write `kb_items` add-only
   and never force an item back to `active`.
2. Brain's KB reader: calls read one catalogue, honour Paused and Not offered, and tie each price to its
   own item.

Until then an old services save can wipe the state, and a caller could still hear a paused item. So the
Status control is behind a server-side Desk flag.

| Variable | Where | Values | Default |
| --- | --- | --- | --- |
| `DESK_KB_ITEM_STATES` | Vercel Desk (server only, never `NEXT_PUBLIC_*`) | `on` shows the Status control; anything else hides it | off (unset) |

## What the owner sees

- **Flag off:** no Status control under More. An item that is already Paused or Not offered still shows
  that state, with Offered as the only other choice, so it is never hidden and the owner can put it back.
  The Remove confirm does not mention Paused.
- **Flag on:** Offered, Paused, Not offered under More › Status.
- Either way: Not included (services), In stock and "Callers can ask you to hold it" (products) are
  unchanged. They are their own columns, not the status the old writer resets.

## Wiring

- `dashboard/src/lib/deskFeatureFlags.ts` `deskKbItemStates()` reads the env (exactly `on`).
- `dashboard/src/app/(desk)/settings/knowledge/page.tsx` passes `statesEnabled={deskKbItemStates()}`.
- `dashboard/src/lib/catalogueView.ts` `statusChoices(statesEnabled, storedStatus)` picks the choices.
- The KB save actions are unchanged: the flag gates the control, not the write contract.
- Dev fixture: `/dev/catalogue?states=on` (with `DASHBOARD_OPEN=true`).

## Turning it on

Set `DESK_KB_ITEM_STATES=on` on the Desk project for an environment only after the Brain KB reader is
live there, then redeploy Desk. Order for prod: Platform writers, then the Brain reader, then this flag.

# Phase 2 — Home services pack (execution plan)

**Outcome:** A trained home-services tenant can book a visit on-call (service + time window + landmark + name), answer area/price bands from catalog/policies, reschedule/cancel, and escalate true emergencies — with appointments visible in the desk.

**Depends on (already landed):** contacts, service_requests, vertical/`home_services`, retail request + notify pattern, playbook router.

**Explicitly deferred:** Google Calendar sync, live transfer, live catalog mid-call search, payments on call.

---

## Architecture

```text
Caller (home_services vertical)
  → HOME SERVICES PLAYBOOK (prompt)
  → create_appointment / update_appointment markers
  → toolExecution validate → db.createAppointment / updateAppointment
  → owner WhatsApp/email notify
  → Desk /appointments (confirm / cancel / done)
```

Reuse `contacts` via `contact_id`. Keep `service_requests` for non-booking notes (enquiry/callback). Appointments are the booking SoR.

---

## Work packages

### 2A — Platform: appointments SoR
- `docs/supabase/appointments.sql` + README + schema notes
- Columns: service_name, when_text, window_start/end (optional), address_landmark, status (`requested|confirmed|cancelled|done`), caller_*, contact_id, call_id, notes, metadata
- RLS: owner select + column-scoped status/notes update
- `src/db.js`: `createAppointment`, `updateAppointment` (by id or latest open for caller phone), soft-fail if migration missing
- Apply on ALCR

### 2B — Brain: playbooks + tools
- `src/conversation/playbooks/homeServices.js` intents:
  - hours_open, directions, service_inquiry, price_band, service_area, book_visit, reschedule, cancel, emergency, human, other
- Router injects when `vertical === home_services`
- Tools: `create_appointment` (requires service + name + when_text + landmark), `update_appointment` (status / when_text; id optional → latest open for caller)
- Markers, validation, confirmations (en/sw/sheng), capabilities, prompts, thin `server.js` handlers + notify
- Resolution: succeeded appointment → `resolved`
- Compiler: HOME SERVICES JOB section
- Onboarding pack: home FAQs/policies/services seed

### 2C — Desk: appointments inbox
- `/appointments` list + status filters (requested / confirmed / cancelled / done)
- Week calendar on Inbox → Visits (`/calls?purpose=job&view=week`). Same appointment rows. No extra nav item.
- Status toggle + nav link
- Mirror Requests UX (no card clutter)

### 2D — Exit criteria / verify
- Unit tests: playbook classify + slot gating, tool invalid/success paths
- Smoke script for home playbooks
- `npm run test:brain` + dashboard `tsc`
- Manual: book visit → row + notify → desk confirm/cancel

---

## Slot contract (voice)

| Intent | Required | Tool |
| --- | --- | --- |
| book_visit | service, name, when, landmark | create_appointment |
| reschedule | when (+ match latest open) | update_appointment |
| cancel | — (+ match latest open) | update_appointment status=cancelled |
| emergency | name, reason | escalate (+ save_caller_info) |

Never invent price bands, coverage areas, or claim booked until backend confirmation.

---

## Visit SOP (phone)

Think this. Do not read it to the caller.

1. Hear book, reschedule, cancel, or "I will be there". Do not agree a time is free yet.
2. **Book:** collect service, name, when, landmark (one missing thing per turn).
3. **Reschedule:** match the caller's latest open visit. Collect only the new when.
4. Silently check hours. If closed or outside hours, offer another time now. Same-hour visits are allowed unless policies say one at a time.
5. Fire `create_appointment` or `update_appointment` and speak nothing. The backend says saved, moved, or closed. It does not reject because another visit already sits on that hour.
6. **Cancel:** `update_appointment` status=cancelled. Speak nothing until the backend confirms.
7. If they only confirm they will be there, acknowledge. Do not open a second visit.

The backend is the only voice that may say a visit is booked or moved. A progress line on the call is "Okay, one moment.", not a save claim.

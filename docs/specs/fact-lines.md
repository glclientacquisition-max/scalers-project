# Fact lines: Brain templates, Voice wording

Status: contract, 2026-10-09. Owner of this file: Brain. Wording: Voice.
Behind `BRAIN_CALL_FIXES_D199` (staging; on only when exactly `on`).
Source call: HD_d199dbbf6b79 (staging re-dial, 2026-10-09 11:41 EAT).

## Split

- **Brain** owns the template set: each template's name, its meaning, its
  required and optional slots, and the write (or read) result that gates it.
  Brain never emits a line whose gate has not passed.
- **Voice** owns the spoken wording for every template in en, sw and sheng,
  in `src/speech/spokenFacts/index.js` (branch `voice/spoken-facts`).
- Brain calls Voice's `renderFactLine(line, { now })` and
  `renderFact(slot, lang, { now })` (`now` anchors relative days; the live call
  passes the current time). Both
  return `null` for an unknown template or a missing required slot. On `null`,
  or while Voice's module is not on the branch, Brain falls back to its own
  wording in `src/conversation/factLine.js`. The import is guarded (optional
  require), so tests pass without Voice's module.
- Every line Brain emits is recorded on the turn trace as `brain.lines[]`
  (the line object below plus the rendered text). Voice's scorer checks those
  lines against the DB. Example: `move_ok` spoken while the old visit is still
  open (`requested` or `confirmed`) is a fail.

## Line object

```js
{
  template: 'move_ok',          // one of the names below
  lang: 'en' | 'sw' | 'sheng',  // caller language for this turn
  slots: { /* typed slots, below */ },
  gate: { /* the result that allowed it: ids, statuses (for the scorer) */ },
}
```

## Slot types

| type | shape | notes |
|---|---|---|
| `string` | `"Carpet Cleaning"` | DB text as stored (service_name, item, address_landmark). Never model text. |
| `enum` | one of the listed values | |
| `datetime` | `{ iso, precision, text? }` | `iso`: UTC ISO-8601 from the DB (`window_start`, `created_at`). `precision`: `'time'` renders relative day ("today", "tomorrow", "kesho"), weekday and clock in Africa/Nairobi; `'day'` renders relative day and weekday, no clock; `'relative'` renders relative to now ("yesterday at 4:47 PM", "jana saa ..."). `text`: stored `when_text` when there is no `iso` (Voice may read it as is). |
| `money` | `{ minor, max_minor?, currency, mode }` | `mode`: `'exact'`, `'from'`, `'range'`. `'from'` and `'range'` use `max_minor` for the top. Not used by the templates below yet; listed so the types stay one set. |
| `id` | uuid string | For the gate and the scorer. Never spoken. |

## Templates

### `visit_open` — an open visit on the caller file

- Required: `job: string`, `status: enum(requested|confirmed)`.
- Optional: `when: datetime` (precision `'time'` when the row has a window,
  else `{ text }`), `place: string`.
- Gate: an `appointments` row for this caller with status `requested` or
  `confirmed`, read at call start. A visit earlier today (Nairobi day) is
  today's visit, not a past one.
- Fires: the open-file read ("what do I have"), and a named-row ask that
  matches a visit ("ile carpet cleaning ya Kitengela").
- `gate`: `{ appointment_id }`.

### `request_open` — an open request or hold on the caller file

- Required: `kind: enum(enquiry|callback|hold|order)`, `item: string`.
- Optional: `when: datetime` (`{ text }` when no window).
- Gate: a `service_requests` row for this caller with status `open`, read at
  call start.
- Fires: after the visits on the open-file read, and on a named-row ask that
  matches the request ("what about the mansion one?" →
  "Mansion Cleaning Custom Quote").
- `gate`: `{ request_id }`.

### `requested_at` — when the caller asked for a row

- Required: `kind: enum(visit|request)`, `job: string` (service or item),
  `requested_at: datetime` with precision `'relative'` (from `created_at`).
- Gate: the row is on the caller file and has `created_at`. The row is the one
  the caller named, else the last row Brain read out, else the next open visit.
- Fires: "when did I request that?", "niliomba lini?".
- `gate`: `{ appointment_id | request_id }`.

### `saved_item` — one thing saved on this call

- Required: `kind: enum(visit|request)`, `job: string`.
- Optional: `when: datetime` (precision `'time'`), `place: string`.
- Never says "moved". There is no `moved` slot: "moved" comes only from
  `move_ok`, which is gated on the update write. A move saved on this call is
  read back as a saved visit at its new time.
- Gate: a `create_appointment`, `update_appointment` or
  `create_service_request` result with status `succeeded` on this call.
- Fires: "what have you saved?", "umesave nini?", one line per saved row.
- `gate`: `{ action, id }`.

### `saved_none` — nothing saved on this call yet

- Slots: none. Optional `next_visit: visit_open slots` when the file has an
  open visit today or later (Brain then also emits that `visit_open` line).
- Gate: no succeeded save result on this call.
- Fires: "what have you saved?" before any save.

### `team_will_confirm` — the saved visit is a request

- Slots: none.
- Gate: at least one `saved_item` of kind `visit` with status `requested`
  (confirmed slots are not available).
- Fires: after the `saved_item` lines.

### `move_ok` — a visit was moved

- Required: `to_when: datetime` (precision `'time'`).
- Optional: `job: string`, `from_when: datetime`, `place: string`.
- Gate: `update_appointment` succeeded with a new time on appointment id T
  (the same row now holds the new window). When the caller is moving a filed
  visit, Brain pins the write to that visit: a bare update gets T's id, and a
  `create_appointment` becomes `update_appointment` on T. A reschedule never
  creates a second live visit.
- Fires: right after that update, for every update that sets a new time
  (no other template says "moved").
- `gate`: `{ appointment_id: T, to_when, filed_visit }` (`filed_visit`: T was
  on the caller file before this call). Scorer: T's row has the new window and
  no other open visit was created on this call for the same service.

### `visit_updated` — a visit changed with no new time

- Optional: `place: string`.
- Gate: `update_appointment` succeeded on row T with no new time (place or
  notes only). Brain does not say "moved" for it.
- Fires: right after that update.
- `gate`: `{ appointment_id: T }`.

## Fallback

`src/conversation/factLine.js` holds Brain's fallback wording for every
template above (en and sw; sheng falls back to sw). It is used only when
Voice's renderer is missing or returns `null`. Voice's wording wins.

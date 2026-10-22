---
owner: brain
last_reviewed: 2026-10-22
status: planned
---

> **Status: planned, not built (Alvin, 22 Oct 2026).** No code, SQL or flag exists for this yet; nothing here is approved for build. Names, places and receipt ids in examples are made up.
>
> Brain's 5 open questions for Alvin are in [§14](#14-open-questions-for-alvin). Spec inputs (from the original header): code at #853 @67e623e4, #854 @92d6b8a7, #849 @80b35e6c, #856 @a313c3a5; #844 greeting_language.sql (staging merge 570fbdff); #845 brain_write_receipts.sql; callerMemory.js; _relay/fact-store-schema.md; _relay/call-summary-contract-v1.md; v2-greeting-and-path-plan.md; Chief of OSS research caller-profile-research-2026-10-22.md
>
> Reference copy of the box brief `briefs/caller-profile-spec.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Caller profile v2: build spec

This is a structured, per-tenant caller profile that BA v2 reads through gated tools and that only confirmed sources write to. It ships on v2 staging first, then to prod one tenant at a time.

**Reading guide.** Where the research and the code disagree, the code wins; §15 lists each case. Any number marked **[PROPOSAL]** is a proposal that hasn't been measured and isn't a legal fact. Alvin decides those, and counsel reviews the privacy ones.

---

## 1. Goal and non-goals

**Goal**
- Each caller gets a typed profile with these parts:
  - Identity: a phone line linked to one or more people, plus the language each person speaks.
  - Properties, meaning the places that get cleaned.
  - Relationship stats.
  - Typed open items carrying receipt ids.
  - Preferences saved only from confirmed sources, with provenance and decay.
  - A one-line last outcome.
- v2 reads the profile through tools. Before the bind it sees only a thin safe card; after the bind it gets a card of about 150 tokens.
- Reschedule or cancel works by item id, with a read-back plus yes.
- Every caller gets the same behaviour, with parity between EN and SW.
- No dead air: the profile is prefetched at ring time and tools read a warm cache.
- The Desk contact page and the A4 summary both feed the profile.

**Non-goals (v1 of this spec)**
- No embeddings, vector memory or free-text dossiers.
- No raw transcripts in the profile.
- No identity check on the caller file; Alvin accepted that risk on 21 Oct at 16:36 EAT. There is only a flag hook for it (§8).
- No change to the v1 path: `callerMemory.js` and `metadata.caller_profile` stay as they are for v1.
- No real availability source.
- No outbound or marketing use.
- The model never writes the profile mid-call.

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Line** | The existing `contacts` row, keyed by `(tenant_id, phone)`. The phone on the line is a **candidate** identity only. |
| **Person** | A human who calls from one or more lines (`caller_persons`). Lines and persons are many-to-many (`line_persons`). |
| **Property** | A place that gets cleaned (`caller_properties`). It links to persons through `person_properties`, and one manager can hold many properties. |
| **bind_state** | `unbound` means there's no line, or the lookup failed or timed out. `candidate` means the line is known but the name isn't confirmed. `bound` means `state.caller.nameConfirmed === true` and, on a shared line, the person has been picked. |
| **Shared line** | More than one confirmed person on the line, or the owner has flagged it in Desk. On a shared line we always ask for the name and never greet by name. We never list the names on file either, because that would leak them. |
| **Fact** | A typed preference row (`caller_facts`) that carries provenance, confidence, validity, expiry and supersede fields. |

---

## 3. Data model

There are five new tables, one consent table, three derived views, two RPCs and small `contacts`/`appointments` additions. The SQL is in §9.

The design prefers views. Stats, open items and last outcome are views over the existing `appointments`, `service_requests`, `calls` and `brain_write_receipts` tables, so nothing is stored twice.

### 3.1 Tables

| Table | Key columns (type) | Keys / constraints | Notes |
|---|---|---|---|
| `contacts` (existing line), new columns | `phone_e164 text` (generated from `phone`), `line_shared bool default false`, `line_shared_source text` (`derived`\|`owner_desk`) | index `(tenant_id, phone_e164) include (id, name_confirmed, last_language, line_shared)` | Keeps the #844 fields `name_confirmed`, `_at`, `_source`, `_call_id` and `metadata.alternate_names` (cap 5), plus `last_language`. |
| `caller_persons` | `id uuid pk`, `tenant_id uuid`, `display_name text` (≤60), `name_key text` (normalised), `preferred_language text` (`en`\|`sw`\|`mix`), `preferred_channel text` (`call`\|`sms`\|`whatsapp`), `name_source text` (`readback_yes`\|`owner_edit`\|`legacy_alternate`), `name_source_ref text`, `name_confirmed_at timestamptz`, `profile_consent bool default true`, `last_seen_at`, `created_at`, `updated_at` | unique `(tenant_id, id)` | A `legacy_alternate` person is **never bindable** until confirmed on a call or by the owner. |
| `line_persons` | `contact_id uuid`, `person_id uuid`, `tenant_id`, `role text` (`primary`\|`household`\|`staff`\|`manager`\|`other`), `source`, `source_ref`, `confirmed_at`, `valid_from`, `valid_to` | pk `(contact_id, person_id)` | Closed rather than deleted. A current row has `valid_to is null`. |
| `caller_properties` | `id`, `tenant_id`, `label text` (≤40, e.g. "Home", "Karen house"), `area text`, `estate text`, `landmark text` (≤80), `access_notes text` (≤120), `size_hint jsonb` (same `{kind, value}` as the #854 `variant`), plus the provenance set in §3.2 | | Typed fields only. `area` should match a `spoken_catalogue.facts.areas[].name` where it can. |
| `person_properties` | `person_id`, `property_id`, `tenant_id`, `role` (`owner`\|`tenant`\|`househelp`\|`manager`), `is_default bool` | pk `(person_id, property_id)` | At most one default per person (partial unique index). |
| `caller_facts` | `id`, `tenant_id`, `person_id`, `property_id null`, `fact_key text` (registry §3.3), `value jsonb`, `say_en text` (≤80), `say_sw text` (≤80), provenance set (§3.2), `call_id uuid null`, `receipt_id uuid null` → `brain_write_receipts.id`, `last_confirmed_at`, `approval text null` (`pending`\|`approved`\|`rejected`, for `stated` rows only) | a partial unique index allows one current row per `(person, property, key)` with confidence other than `stated`; writer idempotency is unique on `(tenant_id, call_id, receipt_id, fact_key)` | Mirrors #854: a typed key registry, and only confirmed values are spoken. |
| `caller_consent` | `id`, `tenant_id`, `contact_id`, `person_id null`, `recording_consent bool`, `profile_consent bool`, `marketing_consent bool`, `notice_version text`, `channel text`, `call_id`, `captured_at` | | This is the evidence for DPA s.29 and s.30. |
| `appointments`, new column | `property_id uuid null` → `caller_properties` | | Nullable. It's set when a v2 booking binds a property. |
| `brain_write_receipts` (#845), changed check | the `tool` vocabulary gains `save_preference` | | It's needed for `pref_confirmed` receipts. |

### 3.2 Provenance set (on `caller_facts` and `caller_properties`)

| Column | Type | Values |
|---|---|---|
| `source` | text | `owner_desk` \| `booking_system` \| `confirmed_receipt` \| `caller_stated_unconfirmed` |
| `source_ref` | text | A Desk user id, appointment id, receipt id or call id |
| `confidence` | text | `verified` (owner or booking) \| `confirmed` (read-back plus yes) \| `stated` |
| `valid_from` / `valid_to` | timestamptz | `valid_to is null` means the row is current |
| `expires_at` | timestamptz null | A row past this point is hidden from reads, then purged |
| `superseded_by` | uuid null | The id of the row that replaced this one |

**Precedence:** `owner_desk` > `booking_system` > `confirmed_receipt` > `caller_stated_unconfirmed`.
- A newer row from an **equal or higher** source closes the old row (`valid_to=now()`, `superseded_by=new.id`).
- A newer row from a **lower** source never closes a higher one. It's saved as `stated` with `approval='pending'` and goes to Desk.
- A correction the caller makes during the call wins **for that call** (in session state), but it's persisted only through a receipt and the rules above.
- A contradicted fact is closed, never deleted. A hard delete happens only on a DPA erasure.

### 3.3 Fact key registry (fixed; anything else is rejected)

| `fact_key` | `value` schema | Scope | Decay **[PROPOSAL]** |
|---|---|---|---|
| `preferred_cleaner` | `{name: string≤40, staff_id?: uuid}` | person (+ property) | 180 days after the last confirming visit |
| `preferred_day` | `{days: ["mon".."sun"]}` | person | 365 days |
| `preferred_time_window` | `{start: "HH:MM", end: "HH:MM"}` (Nairobi) | person | 365 days |
| `service_type_default` | `{service_id: string, name: string, variant?: {kind, value}}` (a #854 `services[].id`) | person + property | 365 days |
| `pets` | `{has_pets: bool, note?: string≤40}` | property | 365 days |
| `products_note` | `{note: string≤60}` | property | 365 days |
| `do_not_contact_window` | `{start: "HH:MM", end: "HH:MM"}` | person | 365 days |

Two more rules apply to every key:
- `stated` rows expire after 30 days unless they're confirmed or approved **[PROPOSAL]**.
- An open item goes `stale` at `due_at + 30 days`. A stale item shows on Desk and is never spoken **[PROPOSAL]**.

Each registry entry also carries `agent_readable` and `speakable_before_bind`, borrowed from Intercom in the research. Every key is `speakable_before_bind=false`.

### 3.4 Derived views (no writes)

| View | Columns | Source |
|---|---|---|
| `caller_stats_v` | `contact_id, tenant_id, calls_total, calls_90d, first_seen_at, last_seen_at, visits_total, visits_done, visits_cancelled, requests_total` | `calls` joined on `(tenant_id, ke_phone_e164(caller_number)) = (tenant_id, contacts.phone_e164)`; `appointments` / `service_requests` joined on `contact_id` |
| `caller_open_items_v` | `item_id text` (`apt:<uuid>` \| `req:<uuid>`), `kind` (`visit` \| `booking_unconfirmed` \| `quote_pending` \| `callback_promised` \| `complaint_open`), `tenant_id, contact_id, row_id, person_name, title, when_text, window_start, window_end, place, property_id, status` (`open` \| `stale`), `is_past bool, due_at, receipt_id uuid null, created_at` | `appointments` with status `requested`/`confirmed` becomes `visit`. `service_requests` with status `open`: `callback` becomes `callback_promised`; `hold`/`order` become `booking_unconfirmed`; `metadata.kind='quote'` becomes `quote_pending`; `metadata.kind='complaint'` becomes `complaint_open`. **Platform:** confirm where `log_complaint` and quote handoffs land. `receipt_id` is the latest `committed` receipt where `write_id = row_id`. |
| `caller_last_outcome_v` | `tenant_id, phone_e164, call_id, emitted_at, outcome, path, call_language, top_receipt jsonb` | The latest `calls.summary → call_summary_event` (A4, #856) for the line. Brain renders the one-liner. |

`is_past` mirrors the past bucket in `callerMemory.js` (D199): a past-dated open row is never spoken as upcoming, and only its count is spoken.

---

## 4. Read path and render format

### 4.1 Timeline (no dead air)

| When | What | Budget |
|---|---|---|
| Ring/answer event (Voice) | Fire the `caller_profile_safe_card(tenant, phone)` RPC in parallel with the greeting TTS. | **≤150 ms p95 [PROPOSAL, unmeasured]**, with a hard timeout of 400 ms. A timeout, an error or no line means `unbound`: the generic greeting plays and nothing is said about a file. |
| The name-confirm turn (C0/C1 path, unchanged) | Once a name is heard and matched to a person, prefetch `caller_profile_bound_card(tenant, contact_id, person_id)` into session state. | Warm by the time the bind happens. Hard timeout 800 ms. If it times out, the call continues bound but without a card, and the tools retry once. |
| After the bind | Tools read session state, so there's no DB round trip. | p95 ≤10 ms. A filler line plays **only** if a cold read goes over 300 ms. It's one short line ("One moment." / "Sekunde moja."), never a generic "Sawa". |

The research suggested a "Let me check" filler on every tool call. With a warm cache that isn't needed, and Alvin's no-dead-air rule is better served without it.

### 4.2 Safe card (before the bind; no names, no history; ~20 tokens)

```
LINE returning | people 2 | shared: ask name, no name greeting | open items: yes | lang: sw
```
If there is no line or the lookup timed out, the safe card reads: `LINE new-or-unknown`.

The name-confirm question itself still uses the #844/#853 name-on-file path. That's the accepted risk; the profile adds **no** pre-bind exposure beyond it. On a shared line the question is an open "May I have your name?" / "Naomba jina lako?". It's never "Are you Grace or Peter?".

### 4.3 Bound card (≤150 tokens hard cap; target 80–110)

These are labelled blocks, each with a character cap (borrowed from Letta). Labels stay constant English so they parse the same way. Values use the call language.

**EN example (~95 tokens)**
```
CALLER Grace W. (confirmed) | lang en | line shared (2 people)
PLACE default: Home, Karen, near Karen Plains gate B | 2 bedroom
STATS 7 calls, 4 visits (1 cancelled), customer since Mar 2026, last call 3 Oct
OPEN apt:7f3a Deep clean 2 bedroom, Sat 25 Oct 9am, Karen [rcpt 91c2]
OPEN req:a01b callback promised, Fri 24 Oct 2pm [rcpt 5d10]
PREFS cleaner: Mary (confirmed) | time: 8am-12pm (owner)
LAST 3 Oct: booked deep clean 2 bedroom, confirmed
```

**SW example (~105 tokens)**
```
CALLER Grace W. (amethibitishwa) | lang sw | line shared (watu 2)
PLACE default: Nyumbani, Karen, karibu na geti B Karen Plains | vyumba 2
STATS simu 7, ziara 4 (1 imeghairiwa), mteja tangu Machi 2026, simu ya mwisho 3 Okt
OPEN apt:7f3a Usafi wa kina vyumba 2, Jumamosi 25 Okt saa tatu asubuhi, Karen [rcpt 91c2]
OPEN req:a01b simu ya kurudishwa imeahidiwa, Ijumaa 24 Okt saa nane mchana [rcpt 5d10]
PREFS msafishaji: Mary (amethibitishwa) | muda: saa mbili - saa sita asubuhi (mmiliki)
LAST 3 Okt: amebook usafi wa kina vyumba 2, imethibitishwa
```

**Render rules**
- Tokens are counted with the same stand-in counter as the tests (`ceil(chars/4)`). Over 150, lines are dropped in this order:
  1. STATS, down to just the last-call date.
  2. A second PREFS item.
  3. A second OPEN item, replaced by "+N more".
  4. PLACE access text.
- CALLER, the first OPEN item and LAST are never dropped.
- Never rendered:
  - `stated` rows
  - expired rows
  - `stale` items
  - another person's items in detail (they appear only as a count: "+1 open item under another name")
  - free text from the legacy `metadata.caller_profile`
- Times are spoken in Nairobi time, through the same speaker the C1 read-back uses: `readbackTime` and the SW clock, so 9am is "saa tatu asubuhi".
- The card goes to the v2 machine's state. It reaches the model prompt only with `BRAIN_V2_MODEL` set to `shadow` or `on`, and `on` isn't for staging.

---

## 5. Tools

Every tool is registered from the start of the call. Each handler checks the gate itself.

| Tool | Gate | Latency | Failure |
|---|---|---|---|
| `get_caller_profile` | `bind_state=bound`, else `{error:"not_bound"}` | ≤10 ms (cache) | No card: `{error:"unavailable"}`. The machine carries on without the card and never says "I can't find your file". |
| `get_open_items` | bound | ≤10 ms | Same as above. |
| `get_caller_history` | bound | ≤10 ms warm, ≤300 ms cold | `{error:"not_bound" \| "unavailable"}` |
| `reschedule_or_cancel` | bound **and** the item belongs to the bound person or is unnamed on the line | propose ≤10 ms; commit p95 ≤600 ms, timeout 2.5 s | On timeout or failure: a `failed` receipt, an owner outbox task, and the line "I couldn't change it just now; the team will call you to confirm." / "Sijaweza kuibadilisha sasa hivi; timu itakupigia kuthibitisha." Never a false "done". |
| `save_preference` | bound, `profile_consent=true`, flag `BRAIN_V2_CALLER_PREFS` | ≤10 ms (records a receipt only) | The receipt write fails silently (`recordWriteReceipt` never throws). The value still applies for this call. |

### 5.1 Schemas

```json
{"name":"get_caller_profile","parameters":{"type":"object","properties":{},"additionalProperties":false}}
```
Returns `{bind_state, person:{id,name,lang}, line:{shared, people}, property?:{id,label,area}, stats:{calls_total,visits_done,visits_cancelled,last_seen_at}, prefs:[{key,say,confidence}], last_outcome?:{at,line}, render:string}`.

```json
{"name":"get_open_items","parameters":{"type":"object","properties":{
  "kind":{"type":"string","enum":["any","visit","booking_unconfirmed","quote_pending","callback_promised","complaint_open"],"default":"any"}},
  "additionalProperties":false}}
```
Returns `{items:[{item_id, kind, title, when_say, place, receipt_id, is_past}], others_count}`. The items are the bound person's own plus unnamed ones on the line, and `others_count` covers the rest.

```json
{"name":"get_caller_history","parameters":{"type":"object","required":["scope"],"properties":{
  "scope":{"type":"string","enum":["visits","preferences","property"]},
  "property_id":{"type":"string"},
  "limit":{"type":"integer","minimum":1,"maximum":5,"default":3}},"additionalProperties":false}}
```

```json
{"name":"reschedule_or_cancel","parameters":{"type":"object","required":["item_id","action"],"properties":{
  "item_id":{"type":"string","pattern":"^(apt|req):[0-9a-f-]{36}$"},
  "action":{"type":"string","enum":["reschedule","cancel"]},
  "new_when":{"type":"object","properties":{"date":{"type":"string"},"time":{"type":"string"}}},
  "confirm_token":{"type":"string"}},"additionalProperties":false}}
```

How `reschedule_or_cancel` works:
- **Two-phase, the C1 pattern.** A call without `confirm_token` is a propose: it runs the validators (hours, area, past time), mints the server token bound to `slotHash`, records a `proposed` receipt, and returns the read-back line. A call with the token, made after `readbackAnswer` says yes, commits through the existing `update_booking` / `cancel_booking` executor.
  - The idempotency key is `call_id:update_booking|cancel_booking:slotHash`, with `item_id` inside the slots.
  - The receipt tool is `book_appointment`, which is the existing mapping.
- **Read-back.** Each read-back speaks the item and the new time, or the item and the fact that it's being cancelled:
  - "To confirm: move your deep clean, 2 bedroom, from Saturday 25 October at 9am to Monday 27 October at 10am. Is that right?" / "Kuthibitisha: tuhamishe usafi wa kina vyumba 2 kutoka Jumamosi 25 Oktoba saa tatu asubuhi hadi Jumatatu 27 Oktoba saa nne asubuhi. Ni sawa?"
  - "To confirm: cancel your deep clean on Saturday 25 October at 9am. Is that right?" / "Kuthibitisha: tughairi usafi wa kina wa Jumamosi 25 Oktoba saa tatu asubuhi. Ni sawa?"
- **Answers.** A caller who repeats the exact read-back time has said yes. A different time is a change. Anything unclear gets one yes/no re-ask through `R.reaskQ`.
- **`req:` items.** A callback, quote or complaint can't be cancelled by voice in v1. The tool returns `{error:"not_cancellable"}`, and the machine makes a `create_handoff` callback (see open question 5).
- **Ambiguity.** If more than one open visit matches and no `item_id` was resolved, ask one which-one question: "The one on Saturday or the one on Monday?". This matches the #854 which-one rule. Never take the first row.
- No end-call while a commit is pending (end-call contract).

```json
{"name":"save_preference","parameters":{"type":"object","required":["fact_key","value"],"properties":{
  "fact_key":{"type":"string","enum":["preferred_cleaner","preferred_day","preferred_time_window","service_type_default","pets","products_note","do_not_contact_window"]},
  "value":{"type":"object"},
  "property_id":{"type":"string"},
  "confirm_token":{"type":"string"}},"additionalProperties":false}}
```

How `save_preference` works:
- It's two-phase. The propose step validates `value` against the registry and returns the read-back ("So I'll note that you prefer mornings, 8 to 12. Is that right?" / "Kwa hivyo nitaandika kwamba unapendelea asubuhi, saa mbili hadi saa sita. Ni sawa?").
- A yes records a `confirmed` receipt with `tool='save_preference'` and the slots `{fact_key, value, person_id, property_id}`. **Nothing is written to `caller_facts` live**; the post-call writer (§6) writes it.
- A no means nothing is saved. An unclear answer gets one re-ask, and if it's still unclear the preference is `stated` (§6).
- At most one preference read-back per call, so the call stays smooth. It's never offered while a booking read-back is open.

### 5.2 Swahili and EN intent coverage (the known gap)

**Root cause.** The current regexes use `\bhamisha` / `\bbadilisha` (in `callFixesD199.js`, `brainState.js` and `goalModel.js`). Swahili verbs take prefixes, so `kuhamisha`, `nihamishie` and `tuihamishe` fail the word boundary. The code-switched `kucancel`, `nikancel` and `ku-cancel` aren't matched anywhere.

**The lasting fix.** One shared EN/SW change/cancel lexicon in `v2/nlu.js`, used by every path.

The matching pattern:
- A Bantu prefix: `(ku|ni|tu|wa|m|u|a|i|ki)?`
- An optional tense marker and object infix: `(na|li|ta|me)?(i|ki|zi|u|ya)?`
- One of the stems: `hamish|sogez|ahirish|badilish|ghair|fut|cancel|kansel|kensel|reschedul|postpon`
- Any suffix: `\w*`

It also covers the hyphenated forms. Questions about policy ("mnafanyaje kama nikicancel?") stay `policy_cancel` (info) under the existing rule in machine.js (`cancel` together with `policy_cancel` resolves to null), and the unit tests pin that.

---

## 6. Write path (single post-call writer)

| Source | Writes | Confidence | When |
|---|---|---|---|
| A `confirmCallerName` readback_yes (#844) | `caller_persons` (upsert on `name_key`), `line_persons` | confirmed | Post-call writer, from the call's name receipt or the `contacts.name_confirmed_call_id = call` row |
| `save_preference` receipt (`confirmed` phase) | `caller_facts` | confirmed | Post-call writer, which also records a `committed` receipt with `write_table='caller_facts'` and `write_id` |
| A preference the caller stated without a yes (unclear after the re-ask, or the caller interrupted) | `caller_facts` with `approval='pending'` and `expires_at=now()+30d` | stated | Post-call writer. Desk shows it for approval. |
| A committed booking or reschedule receipt with a bound place | `caller_properties` (match on area + landmark, else insert), `person_properties`, `appointments.property_id`; also refreshes `last_confirmed_at` on a matching `preferred_cleaner` / `service_type_default` | verified (booking_system) | Post-call writer |
| A Desk owner edit | Any table directly, through server actions | verified (owner_desk) | Immediately; it wins the precedence order |
| The A4 `call.summary.ready` event | Nothing is stored. `caller_last_outcome_v` reads it, and `caller_persons.last_seen_at` / `preferred_language` are updated for the **bound** person only. | | On the event |

**Writer**
- `ProfileWriter`, in `src/conversation/v2/profileWriter.js`, is registered with `onCallSummaryReady(fn)` (#856). By the time it runs, the 90 s reconnect grace has passed.
- It reads `getWriteReceipts(callId)` (#845) and the v2 `finished(callSid)` result.
- It's idempotent on `(tenant_id, call_id, receipt_id, fact_key)`. A re-emit with `{replaces:true}`, or a replay, is a no-op.
- When a write fails or the input is empty, the previous state stays as it was. It never throws into the call path.
- It skips a person whose `profile_consent=false`.
- It never infers facts from the transcript or from model output. Only receipts and confirmed fields count.
- Without `WRITE_RECEIPTS=1` and the #691/#845 SQL there are no receipt ids, so the writer does nothing and the prefs tool stays off.

**Decay job (nightly, Platform):**
- Hide rows where `expires_at < now()`; reads already filter them.
- Purge them 30 days later **[PROPOSAL]**.
- Mark open items `stale` (computed in the view).
- Run the retention purge (§10).

---

## 7. Interaction with the existing flow

- **C0/C1 name confirmation** is the only thing that binds a person. On a shared line the bind also needs a person match through `matchCardPerson` / `namesMatch`, with the same normalisation as `callerMemory.js`. A name that matches no person on the line binds a **new** person after the read-back plus yes.
- **Commit rule.** Order, quote, visit, booking, callback, reschedule and cancel all need a read-back of the key details plus a yes. Preferences need a read-back plus yes to reach `confirmed`.
- **Accepted risk (#853).** v2 can say the name on file and open bookings to anyone on the number. The profile doesn't widen that, and it narrows it in two ways:
  - Other people's items are counted, not detailed.
  - Nothing is rendered before the bind.

---

## 8. Flags (all off by default)

| Flag | Values | Requires | Effect |
|---|---|---|---|
| `BRAIN_V2_CALLER_PROFILE` | `off` \| `shadow` \| `on` | `BRAIN_V2=on`, `BRAIN_V2_MODE=live`, tenant in `BRAIN_V2_TENANTS`, `BRAIN_V2_OWNS_CALL=1` (which implies `BRAIN_V2_COMMIT_SAFETY`) | `shadow` prefetches, renders and logs the size, latency and would-say output, but doesn't inject anything and doesn't expose the tools. `on` turns on the cards and the read tools plus `reschedule_or_cancel`. |
| `BRAIN_V2_CALLER_PROFILE_TENANTS` | csv of tenant ids | | The per-tenant prod allowlist. Empty means none. |
| `BRAIN_V2_CALLER_PREFS` | 0/1 | `BRAIN_V2_CALLER_PROFILE=on`, `WRITE_RECEIPTS=1`, §9 SQL | Turns on the `save_preference` tool. |
| `BRAIN_V2_PROFILE_WRITER` | 0/1 | `CALL_SUMMARY_EVENT=1`, `WRITE_RECEIPTS=1`, §9 SQL | Turns on the post-call writer. |
| `BRAIN_V2_PROFILE_IDENTITY_CHECK` | 0/1 | | **Hook only, a no-op at 0** (Alvin's decision). At 1 the bound card and the open items would need a second factor. Not built in v1. |
| `DESK_CALLER_PROFILE` | 0/1 | §9 SQL | The Desk contact page shows people, properties, facts with their source, pending approvals, export and erase. |

The existing flags are unchanged. `BRAIN_V2_FACT_STORE` gives the item names and service ids (`itemFromFacts`), and when it's off the profile uses the raw `service_name`. `VOICE_END_CALL_HONOUR` and `CALL_SUMMARY_EVENT` behave as they do today.

**Important:** don't set `WRITE_RECEIPTS=1` before the #691 SQL is applied, or every write will fail. The same applies to `BRAIN_V2_CALLER_PREFS` and `BRAIN_V2_PROFILE_WRITER`, which must not be turned on before the §9 SQL.

---

## 9. Migration SQL (for Platform; staging first; prod needs Alvin's GO)

File: `docs/supabase/caller_profile_v1.sql`. It's additive and idempotent, and must run after `contacts_and_requests.sql`, `appointments.sql`, `greeting_language.sql` (#844) and `brain_write_receipts.sql` (#845).

**Platform should check these first:**
- (a) Whether `calls.summary` is `text` or `jsonb`. `foundation_bootstrap` says `text`, but `mergeCallSummaryMeta` treats it as JSON. The views cast through `::text::jsonb`.
- (b) The return type of `current_user_tenant_ids()`.
- (c) Where complaint and quote handoff rows land.
- (d) That `ke_phone_e164` matches `callerPhoneFrom` (#856) on the test vectors in §11.

```sql
-- caller_profile_v1.sql  (PROPOSAL until Platform applies; staging first)

create or replace function public.ke_phone_e164(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when regexp_replace(p,'\D','','g') ~ '^254[17][0-9]{8}$' then '+' || regexp_replace(p,'\D','','g')
    when regexp_replace(p,'\D','','g') ~ '^0[17][0-9]{8}$'   then '+254' || substr(regexp_replace(p,'\D','','g'),2)
    when regexp_replace(p,'\D','','g') ~ '^[17][0-9]{8}$'    then '+254' || regexp_replace(p,'\D','','g')
    else null end $$;

alter table public.contacts add column if not exists phone_e164 text
  generated always as (public.ke_phone_e164(phone)) stored;
alter table public.contacts add column if not exists line_shared boolean not null default false;
alter table public.contacts add column if not exists line_shared_source text
  check (line_shared_source is null or line_shared_source in ('derived','owner_desk'));
create index if not exists contacts_tenant_phone_e164_idx
  on public.contacts (tenant_id, phone_e164) include (id, name_confirmed, last_language, line_shared);
create index if not exists calls_tenant_caller_e164_idx
  on public.calls (tenant_id, public.ke_phone_e164(caller_number), created_at desc);

create table if not exists public.caller_persons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null check (char_length(display_name) <= 60),
  name_key text not null,
  preferred_language text check (preferred_language in ('en','sw','mix')),
  preferred_channel text check (preferred_channel in ('call','sms','whatsapp')),
  name_source text not null check (name_source in ('readback_yes','owner_edit','legacy_alternate')),
  name_source_ref text,
  name_confirmed_at timestamptz,
  profile_consent boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists caller_persons_tenant_key_idx on public.caller_persons (tenant_id, name_key);

create table if not exists public.line_persons (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  person_id uuid not null references public.caller_persons(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary','household','staff','manager','other')),
  source text not null check (source in ('owner_desk','booking_system','confirmed_receipt','caller_stated_unconfirmed')),
  source_ref text,
  confirmed_at timestamptz,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  primary key (contact_id, person_id)
);

create table if not exists public.caller_properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text check (char_length(label) <= 40),
  area text, estate text,
  landmark text check (char_length(landmark) <= 80),
  access_notes text check (char_length(access_notes) <= 120),
  size_hint jsonb,
  source text not null check (source in ('owner_desk','booking_system','confirmed_receipt','caller_stated_unconfirmed')),
  source_ref text,
  confidence text not null check (confidence in ('verified','confirmed','stated')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  expires_at timestamptz,
  superseded_by uuid references public.caller_properties(id),
  created_at timestamptz not null default now()
);

create table if not exists public.person_properties (
  person_id uuid not null references public.caller_persons(id) on delete cascade,
  property_id uuid not null references public.caller_properties(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','tenant','househelp','manager')),
  is_default boolean not null default false,
  primary key (person_id, property_id)
);
create unique index if not exists person_properties_one_default
  on public.person_properties (person_id) where is_default;

create table if not exists public.caller_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.caller_persons(id) on delete cascade,
  property_id uuid references public.caller_properties(id) on delete cascade,
  fact_key text not null check (fact_key in ('preferred_cleaner','preferred_day','preferred_time_window',
    'service_type_default','pets','products_note','do_not_contact_window')),
  value jsonb not null,
  say_en text check (char_length(say_en) <= 80),
  say_sw text check (char_length(say_sw) <= 80),
  source text not null check (source in ('owner_desk','booking_system','confirmed_receipt','caller_stated_unconfirmed')),
  source_ref text,
  confidence text not null check (confidence in ('verified','confirmed','stated')),
  call_id uuid references public.calls(id) on delete set null,
  receipt_id uuid references public.brain_write_receipts(id) on delete set null,
  approval text check (approval is null or approval in ('pending','approved','rejected')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  expires_at timestamptz,
  superseded_by uuid references public.caller_facts(id),
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint caller_facts_stated_needs_expiry check (confidence <> 'stated' or expires_at is not null)
);
create unique index if not exists caller_facts_current_uidx
  on public.caller_facts (person_id, coalesce(property_id,'00000000-0000-0000-0000-000000000000'::uuid), fact_key)
  where valid_to is null and confidence <> 'stated';
create unique index if not exists caller_facts_writer_idem_uidx
  on public.caller_facts (tenant_id, call_id, receipt_id, fact_key);
create index if not exists caller_facts_person_idx on public.caller_facts (person_id) where valid_to is null;

create table if not exists public.caller_consent (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  person_id uuid references public.caller_persons(id) on delete cascade,
  recording_consent boolean, profile_consent boolean, marketing_consent boolean,
  notice_version text, channel text, call_id uuid references public.calls(id) on delete set null,
  captured_at timestamptz not null default now()
);

alter table public.appointments add column if not exists property_id uuid
  references public.caller_properties(id) on delete set null;

alter table public.brain_write_receipts drop constraint if exists brain_write_receipts_tool_check;
alter table public.brain_write_receipts add constraint brain_write_receipts_tool_check check (
  tool in ('book_appointment','create_order','request_callback','log_complaint','escalate','quote','save_preference'));

-- Views (security_invoker so table RLS applies to owners)
create or replace view public.caller_open_items_v with (security_invoker = true) as
select 'apt:' || a.id as item_id, 'visit'::text as kind, a.tenant_id, a.contact_id, a.id as row_id,
       a.caller_name as person_name, a.service_name as title, a.when_text, a.window_start, a.window_end,
       a.address_landmark as place, a.property_id,
       case when coalesce(a.window_end, a.window_start) < now() - interval '30 days' then 'stale' else 'open' end as status,
       coalesce(a.window_end, a.window_start) < now() as is_past,
       a.window_start as due_at,
       (select r.id from public.brain_write_receipts r where r.write_id = a.id and r.phase = 'committed'
         order by r.created_at desc limit 1) as receipt_id,
       a.created_at
from public.appointments a where a.status in ('requested','confirmed')
union all
select 'req:' || s.id,
       case when s.request_type = 'callback' then 'callback_promised'
            when s.metadata->>'kind' = 'quote' then 'quote_pending'
            when s.metadata->>'kind' = 'complaint' then 'complaint_open'
            when s.request_type in ('hold','order') then 'booking_unconfirmed'
            else 'callback_promised' end,
       s.tenant_id, s.contact_id, s.id, s.caller_name, coalesce(s.item, s.request_type), s.when_text, null, null,
       null, null,
       case when coalesce((s.metadata->>'due_at')::timestamptz, s.created_at) < now() - interval '30 days' then 'stale' else 'open' end,
       coalesce((s.metadata->>'due_at')::timestamptz, now() + interval '1 day') < now(),
       (s.metadata->>'due_at')::timestamptz,
       (select r.id from public.brain_write_receipts r where r.write_id = s.id and r.phase = 'committed'
         order by r.created_at desc limit 1),
       s.created_at
from public.service_requests s where s.status = 'open';

create or replace view public.caller_stats_v with (security_invoker = true) as
select c.id as contact_id, c.tenant_id,
  (select count(*) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164) as calls_total,
  (select count(*) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164
     and k.created_at > now() - interval '90 days') as calls_90d,
  (select min(k.created_at) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164) as first_seen_at,
  (select max(k.created_at) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164) as last_seen_at,
  (select count(*) from public.appointments a where a.contact_id = c.id) as visits_total,
  (select count(*) from public.appointments a where a.contact_id = c.id and a.status = 'done') as visits_done,
  (select count(*) from public.appointments a where a.contact_id = c.id and a.status = 'cancelled') as visits_cancelled,
  (select count(*) from public.service_requests s where s.contact_id = c.id) as requests_total
from public.contacts c;

create or replace view public.caller_last_outcome_v with (security_invoker = true) as
select distinct on (k.tenant_id, public.ke_phone_e164(k.caller_number))
  k.tenant_id, public.ke_phone_e164(k.caller_number) as phone_e164, k.id as call_id,
  (k.summary::text::jsonb -> 'call_summary_event' ->> 'emittedAt')::timestamptz as emitted_at,
  k.summary::text::jsonb -> 'call_summary_event' ->> 'outcome' as outcome,
  k.summary::text::jsonb -> 'call_summary_event' ->> 'path' as path,
  k.summary::text::jsonb -> 'call_summary_event' ->> 'callLanguage' as call_language,
  k.summary::text::jsonb -> 'call_summary_event' -> 'receipts' -> 0 as top_receipt
from public.calls k
where k.summary is not null and k.summary::text like '{%' and k.summary::text like '%call_summary_event%'
order by k.tenant_id, public.ke_phone_e164(k.caller_number), k.created_at desc;

-- RPCs: service role only (voice server). One round trip each.
create or replace function public.caller_profile_safe_card(p_tenant uuid, p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'bind_state','candidate','contact_id',c.id,'line_shared',c.line_shared,
      'known_person_count',(select count(*) from line_persons lp where lp.contact_id=c.id and lp.valid_to is null),
      'has_open_items',exists(select 1 from caller_open_items_v o where o.contact_id=c.id and o.status='open' and not o.is_past),
      'preferred_language',c.last_language)
    from contacts c where c.tenant_id=p_tenant and c.phone_e164=ke_phone_e164(p_phone) limit 1),
    jsonb_build_object('bind_state','unbound')) $$;
-- caller_profile_bound_card(p_tenant uuid, p_contact uuid, p_person uuid) returns jsonb:
--   {person, line, default_property, stats (caller_stats_v), prefs (caller_facts current, not expired,
--    confidence <> 'stated'), open_items (caller_open_items_v, own + unnamed detailed, others counted),
--    last_outcome (caller_last_outcome_v)}. Same security definer / search_path pattern. Brain owns the shape.
revoke all on function public.caller_profile_safe_card(uuid,text) from public, anon, authenticated;
grant execute on function public.caller_profile_safe_card(uuid,text) to service_role;

-- RLS: service role writes; owners read/edit their tenant (Desk). Verify current_user_tenant_ids() return type.
do $$ declare t text; begin
  foreach t in array array['caller_persons','line_persons','caller_properties','person_properties','caller_facts','caller_consent'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('drop policy if exists %I on public.%I', t||'_owner_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id in (select public.current_user_tenant_ids())) with check (tenant_id in (select public.current_user_tenant_ids()))', t||'_owner_rw', t);
  end loop; end $$;
```

**Backfill (staging first, as a separate script, run by Platform):**
- Each `contacts` row with `name_confirmed=true` gets a `caller_persons` row (with `name_source` taken from `name_confirmed_source`) and a `line_persons` row with role `primary`.
- Each `metadata.alternate_names` entry gets a `caller_persons` row marked `legacy_alternate` and a `line_persons` row marked `household`. These can't be bound until they're confirmed.
- `line_shared=true` where there's more than one non-legacy person.
- **Not backfilled:** `metadata.caller_profile` (standing, typical_job, landmark, persons{}). It has no provenance and is free text, and leaving it out is the DPA s.25 minimisation choice. v1 keeps reading it.

---

## 10. Privacy and identity risk (Kenya Data Protection Act 2019)

| Requirement | What we build | Owner |
|---|---|---|
| s.29 notice | A short spoken notice at the call opening (Voice owns the wording and the greeting length; see open question 4), an SMS/WhatsApp link to the full notice, and `caller_consent.notice_version`. | Voice, Ops |
| s.25 minimisation and accuracy | Typed keys only. No transcripts in the profile. The legacy free-text profile isn't migrated. Precedence plus supersede keeps the data accurate. | Brain, Platform |
| Cross-border processing (the voice and model providers) | Needs documented safeguards or consent. **Counsel to review.** The dev rule stays: prod call data stays off GitHub and away from Gemini in tests (stand-ins only). | Alvin, counsel |
| s.26 access and objection | Desk "export person" (every row with its provenance) and "correct". If the caller objects, `profile_consent=false`: no reads and no writes for that person. | Desk |
| s.39 and Reg 19 retention **[PROPOSAL, counsel]** | Profile facts are kept 24 months after the last interaction. Stated or expired rows are purged 30 days after expiry. Receipts are kept per the tenant's business-records needs. A nightly purge plus a quarterly audit log. | Platform, Ops |
| s.40 and Reg 12 erasure within **14 days** | Hard-delete the person and the rows scoped to them, detach them from the line and property, and propagate to processors. Anonymised visit counts are kept for billing. Desk tracks the SLA. | Desk, Platform |
| Controller and processor | The tenant is the controller and Scalers is the processor, so a DPA contract is needed. ODPC registration hasn't been verified. **Counsel.** | Alvin |

**Identity risk (accepted for v2).**
- A phone number isn't a person. Anyone holding a shared, lost or reassigned SIM can, on the #853 name-confirm path, hear the name on file and, once bound, the card's open items and preferences.
- Mitigations in this spec:
  - A thin pre-bind card.
  - On a shared line we ask for the name and never list names.
  - Other people's items are counted, not detailed.
  - Addresses are given as an area and landmark, never in full.
  - No payment data.
  - `BRAIN_V2_PROFILE_IDENTITY_CHECK` is a hook for a later second factor.
- Reassigned SIM: when the bound name confirms as a **new** person on a line whose primary person hasn't been seen for over 12 months **[PROPOSAL]**, Desk gets a flag to review the line.

---

## 11. Tests

All tests use stand-in models with the keys unset, and synthetic data only. No prod call data.

| Kind | Cases |
|---|---|
| Unit (Brain) | Render under 150 tokens for each worst-case fixture, with the drop order holding. EN/SW render snapshots. `not_bound` from every read tool before the bind. The gate on a shared line, where the name must match a person. Precedence (a lower source never closes a higher one; equal or higher supersedes). Expiry hides rows. `stated` rows are never rendered. A `stale` or past item is never spoken as upcoming. Registry validation rejects an unknown key or a bad value. `ke_phone_e164` and `callerPhoneFrom` agree on `0712…`, `+254712…`, `254712…`, `712…`, `0110…`, junk and null. |
| Writer | Idempotent replay and `{replaces:true}`. A failed receipt writes nothing. `profile_consent=false` is skipped. Without `WRITE_RECEIPTS` it does nothing. A booking with a place creates or matches a property. A name receipt creates a person. The writer never throws. |
| Reschedule/cancel | Propose then yes then commit. An exact repeated time counts as yes. A different time is a change and triggers a new read-back. Unclear gets one re-ask. "Okay wait" and "Sawa lakini" aren't a yes. Two matching visits get a which-one question, never the first row. Trying to cancel a `req:` item gives a handoff. A commit timeout gives the failure line plus an outbox task, never "done". No end-call while a write is pending. |
| SW lexicon | `kuhamisha`, `nihamishie`, `tuihamishe`, `sogeza`, `ahirisha`, `kughairi`, `futa booking`, `kucancel`, `nikancel`, `ku-cancel` and `reschedule` all become change/cancel. "Mnafanyaje nikicancel?" and "what's your cancellation policy" stay `policy_cancel`. |
| Edge sweep | No line. Lookup timeout (fail closed to unbound). A line with only `legacy_alternate` persons. A shared line where the caller gives a third name (a new person after the yes). An owner renames the contact mid-week (the #844 reset trigger means no bind until re-confirmed). A deleted person. An open item past its due date. 25 open items (the card shows the top 1 plus "+N more"). An unconfirmed price in a service default is never spoken. The caller objects to the profile. A reconnect within 90 s keeps the bind (one runner per call sid). A null phone. |
| E2E synthetic calls (`v2OwnsSim`) | EN and SW: returning single person. Shared line. New caller. Reschedule. Cancel. Preference save. Preference unclear (stated). Bound card prefetched before the bind turn, with no dead air (the assertion: no turn waits on the DB). |
| Regressions to keep green | `brainV2.test.js`, `brainV2commitSafety.test.js`, `brainV2ownsCall.test.js`, `v2OwnsCallE2e.test.js`, `brainV2factStore.test.js`, `brainWriteReceipts.test.js`, `callerMemory.test.js` (v1 unchanged), `greetingLanguage.test.js` (#844), the A4 summary tests (#856), and the clock-pinned tests (no wall-clock dependence). |

---

## 12. Rollout

| Stage | Flags | Acceptance to move on |
|---|---|---|
| 0. Migration (staging) | Apply §9 plus the backfill (Platform, with Alvin's yes) | The views return rows for the staging tenant. Safe-card RPC p95 measured (target ≤150 ms **[PROPOSAL]**). Owner RLS checked with a read-only staging SELECT. |
| 1. Staging shadow | `BRAIN_V2_CALLER_PROFILE=shadow` on the C3 stack | Over at least 20 synthetic calls: 0 renders over 150 tokens, 0 pre-bind renders with a name or history, safe-card timeouts under 1%, and 0 added turn latency. |
| 2. Staging live | `=on`, then `BRAIN_V2_PROFILE_WRITER=1`, then `BRAIN_V2_CALLER_PREFS=1`, each with Alvin's yes | Alvin's listen on EN and SW: returning caller, shared line, reschedule, cancel and preference. 100% of commits have a read-back plus yes plus a committed receipt. 0 false "done". 0 writer duplicates. Desk shows the facts with their source. |
| 3. Prod, one tenant | Prod SQL with **Alvin's GO**, then `BRAIN_V2_CALLER_PROFILE_TENANTS=<1 tenant>` in shadow for 3 days, then on | Over at least 50 real calls (reviewed in Desk, not exported): 0 privacy incidents, reschedule/cancel success at least 95% of attempts, no rise in hang-ups, and the owner confirms the card is right on 10 sampled callers. |
| 4. Prod, more tenants | Add tenants one at a time | The same metrics per tenant, plus the erasure SLA tested once. |

Rollback for each stage is turning the flag off. The tables stay, and the data is unaffected.

---

## 13. Owners

| Lane | Owns |
|---|---|
| **Brain** | The key registry, renderer, tools, gates, reschedule/cancel through C1, the `ProfileWriter`, the SW/EN lexicon, the bound-card RPC shape, and the tests. |
| **Platform** | §9 SQL, the backfill, RLS, the RPCs, the indexes, the decay and retention jobs, and the staging and prod applies (each with Alvin's yes). |
| **Desk** | The contact page: people, properties, facts with source and expiry, pending approvals, owner edits as `owner_desk`, "line shared" toggle, export, erase, and the SLA tracker. |
| **Ops** | The A4 sender stays as it is. Ops also confirms that `caller_last_outcome_v` matches the summary sent, runs the retention audit log, and owns the notice SMS link. |
| **Voice** | Firing the safe card at ring, in parallel with the greeting. The opening notice line (s.29). The open name ask on a shared line. Turn-taking is unchanged. |

---

## 14. Open questions for Alvin

1. **Shared lines.** Should another person's open items be **counted only** ("+1 under another name"), which is the default, or read out in detail the way #853 does today?
2. **Precedence.** The research ranks owner edits above a caller's confirmed change. So when a caller confirms a new time window that differs from one the owner entered, it applies to this call and goes to Desk for approval. Accept that, or should a caller's confirmed change replace the owner value?
3. **Numbers to sign off.** Decay (180/365/30 days), the 150 ms p95 target, and retention (24 months for facts; stated rows purged 30 days after expiry). These are proposals. Should we also brief counsel on the DPA items: the notice, cross-border processing, ODPC registration and the controller/processor contract?
4. **Spoken notice (s.29).** Add one short line to the opening ("We keep your booking details to serve you"), or send the notice by SMS/WhatsApp after the call instead? The line adds about 2 s to every call.
5. **Cancelling by voice.** Can callers cancel an open callback, quote or complaint by voice? The default is no: they get a callback handoff instead. And which tenant goes first in prod?

---

## 15. Where the code differs from the research (the code wins)

| Research said | Code says (refs) | Spec uses |
|---|---|---|
| #854 has per-fact provenance columns plus supersede/versioning, so "one library serves both" | #854 is a JSON doc compiled at owner Save into `tenants.spoken_catalogue.facts`, with no new tables (`_relay/fact-store-schema.md`, `factStore.js`). Provenance is a `confirmed` flag. Versioning is per doc (`tenant_spoken_catalogue_versions`, `sourceHash`), not per fact. | Mirror the typed key registry, "only confirmed is spoken", the which-one rule and `itemFromFacts` naming. Per-row supersede is new for caller facts and isn't shared with #854. |
| Visits have `property_id`, `scheduled_for`, `cleaner_id` and `outcome` | `appointments` has `window_start/window_end`, `when_text`, `address_landmark`, `status` (requested\|confirmed\|cancelled\|done), `caller_name`, `caller_phone` and `contact_id`. There's no property or cleaner column. | Add a nullable `appointments.property_id`. `preferred_cleaner` is name-only with an optional `staff_id` until a staff table exists. |
| A separate `phone_line` table | `contacts` is already unique per `(tenant_id, phone)` and holds the #844 name-confirm fields. | `contacts` is the line, with `phone_e164` and `line_shared` added. |
| callerMemory.js "not re-read" | `callerMemory.js` already derives `sharedLine` from `metadata.alternate_names` (D199 `alternateIsAPerson`), sets `greetByName=false` on a shared line, and reads a free-text `metadata.caller_profile` {standing, language, typical_job, landmark, persons{}}. | The shared-line logic carries forward. The free-text profile isn't migrated (minimisation). v1 is unchanged. |
| A post-call writer for everything | C1 (#849) commits bookings, reschedules and cancels **live** with token plus receipt. | Business rows stay live (C1). Only the **profile** tables are written post-call. |
| The tools are Gemini native tools (#855), with a "Let me check" filler | The v2 machine is deterministic. `BRAIN_V2_MODEL=on` isn't for staging. #855's tool wiring wasn't re-checked for this spec. | The tools are v2 machine functions, which the model sees only in shadow or on. Fillers play only on reads over 300 ms. |
| Idempotent on `(call_id, receipt_id)` | `brain_write_receipts` holds one row per `(idempotency_key, phase)`, where the key is `call_id:tool:slotHash`. | The writer's unique key is `(tenant_id, call_id, receipt_id, fact_key)`, where `receipt_id` is the id of the `confirmed`-phase row. |

The Chief of OSS research has been folded in throughout, so there is no separate "to fold in" section.

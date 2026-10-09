# Handoff record (one per call)

Status: DRAFT; decisions locked 2026-10-09 (Chief under Alvin's delegation,
Voice and Desk replies, Alvin on SMS). See "Locked decisions". Nothing here is built except Phase 0
(BRAIN_CONFIRMED_COVERAGE, `src/conversation/confirmedCoverage.js`), whose
`state.needs[]` entries already use the `needs[]` shape below.
Owner: Brain (contract + brain side). Voice writes delivery; Desk reads and
resolves. Design source: Voice's escalation design, approved by Alvin.

## Locked decisions (2026-10-09)

1. **Strict coverage rule.** With BRAIN_CONFIRMED_COVERAGE on, coverage is
   claimed only from an explicit owner row on `policies.coverage_areas` (plus
   a matching `value_hash` under FACT_HASH_MODE). No owner row = unconfirmed.
   The flag stays **off in prod** until Aris has owner-confirmed coverage, and
   **off everywhere** until Desk ships the coverage confirm action (Desk PR 3,
   the drawer); the field moves into Locations in Desk PR 5.
2. **"Three failed repairs"** = the assistant's own conversation repair
   counter (`state.repair.failureCount`), three failed in a row. Not a caller
   reporting the same fault fixed three times.
3. **Frustration** is off by default; the owner can switch it on per playbook.
4. **Urgent alert channel.** Email first while SMS is off. SMS (locked by
   Alvin): once the tenant's SMS allowance is used up, an urgent SMS goes out
   only if the tenant has on-demand on, billed as on-demand. Otherwise the
   alert goes by email, `delivery.sms = { state: 'skipped', reason:
   'allowance_exhausted' }`, and no SMS is sent. The check is Ops-Billing's
   `claim_sms_units(p_tenant_id, p_units, p_idempotency_key, p_strict)`
   (draft `2026-10-09_claim_sms_units.sql`, not applied; prod SQL needs
   Alvin's GO). Brain does not own it. The urgent SMS path calls it with
   `p_strict = true` and the urgent key below:
   - outcome `included` or `on_demand`: send the SMS.
   - outcome `refused`: no SMS, `delivery.sms` skipped `allowance_exhausted`, send email.
   - database error: fail closed for this path: no SMS, email only.
   - The old `consume_sms_units` is not used for handoff alerts.
11. **Idempotency keys (locked).** A claim is remembered per key and the
    record `version` bumps on every write, so no send key includes the
    version (a later write would resend and rebill).
    - Urgent alert, SMS claim and `notify_sends` row:
      `handoff:<call_id>:urgent:<rule_id>:<channel>`, e.g.
      `handoff:<call_id>:urgent:safety:sms`. Matches "at most one alert per
      rule per call".
    - End-of-call summary: `handoff:<call_id>:summary:<channel>`. Sent once per
      channel per call. A later change (name captured, need resolved) updates
      the record and the Desk card; it is not re-sent.
5. **Timing.** Voice fires the alert as soon as the rule matches and does not
   block speech. The agent never says the team was alerted until the send
   confirms (`delivery.<channel>.state = 'sent'`). Before that the only line
   is "I'm getting this to the team now" (sw: "Ninaifikisha kwa timu sasa hivi").
6. **Name on urgent alerts.** `validateEscalation` drops the name requirement
   for urgent alerts only: the caller ID phone is enough, `caller_name_source
   = 'none'`, and the same record is updated (`version+1`) once the name is
   captured. Non-urgent escalation keeps the name requirement.
7. **End-of-call writer** (Voice-owned hook, today `writeHangupSummary`) must
   run on every close path: hangup, socket drop, farewell, outage clip.
8. **Voice structured path.** Voice wires #614's `src/speech/structured/facts.js:91`
   and verify's covered / not-covered lines to `speakableCoverageAreas(profile)`
   (`src/conversation/confirmedCoverage.js`) when the flag is on.
9. **Desk Needs-you.** One card per handoff record (per call), `needs[]` shown
   as a checklist (open / resolved / handed off). Cards sort by urgency, then
   callback window. A card stays open while any need is open.
10. **Urgent-rules UI.** A per-playbook toggle list in Settings. Choosing a
    playbook seeds the defaults; the owner switches each rule on or off.
    Stored in `tenants.urgent_rules` keyed by stable rule id (below), never
    by label text.

## Why

Today a call's owner-facing outcome is spread over `calls.summary` /
`resolution` / `resolution_note`, `service_requests`, `appointments`,
`notify_sends`, and the `escalate` tool result. Nothing says "these are the
things the caller still needs, how urgent, and did the owner get told". The
handoff record is that one row. It reuses the existing rows by link; it does
not copy them.

## Record shape (`public.call_handoffs`, one row per call)

| field | type | notes |
|---|---|---|
| `call_id` | uuid PK, FK calls | idempotency key. One row per call, ever. |
| `tenant_id` | uuid | RLS scope. |
| `version` | int | +1 on every write. Writers send `expected_version` (optimistic lock). |
| `needs` | jsonb[] | see below. |
| `urgency` | `none`/`soon`/`now` | `now` = alert immediately (1c). |
| `urgency_reason` | text | stable rule id + short reason, e.g. `safety: "water everywhere"`. |
| `callback_window` | jsonb | `{ text, start, end }` Nairobi time, only as the caller said it. Never invented. Null when not said. |
| `language` | `en`/`sw`/`sheng` | from `state.language.current`. |
| `caller_name` | text | code-held only. |
| `caller_name_source` | `file_confirmed`/`asked_saved`/`none` | `file_confirmed` = phone file + caller said yes; `asked_saved` = asked on this call and saved; `none` = no name (an urgent alert still goes on caller ID; the record is updated when the name is captured). |
| `caller_name_confidence` | numeric 0..1 | 1.0 file_confirmed, from STT/quality for asked_saved, 0 none. |
| `returning_caller` | bool | `state.returning` has a file. |
| `hold_ids` | uuid[] | `service_requests` with `request_type='hold'` from this call. |
| `visit_ids` | uuid[] | `appointments` from this call. |
| `request_ids` | uuid[] | other `service_requests` (callback, enquiry, order). |
| `summary` | text | exactly two lines: line 1 who + what, line 2 what is still open. No vendor names, no invented facts. |
| `delivery` | jsonb | per channel, see below. Derived from `notify_sends`, not a second ledger. |
| `status` | `open`/`alerted`/`handed_off`/`closed` | record status (transitions below). |
| `created_at` / `updated_at` / `closed_at` | timestamptz | |

`needs[]` item (Phase 0 already writes `kind`, `text`, `place`, `status`,
`open_reason`, `outcome`, `created_turn`):

```json
{
  "id": "n1",
  "kind": "coverage_confirm | visit | hold | callback | price | stock | eta | policy | human | complaint | payment_dispute | other",
  "text": "Confirm whether we serve Syokimau",
  "status": "open | resolved | handed_off",
  "outcome": "visit_saved | answered_from_file | request_saved | ... (when resolved)",
  "open_reason": "coverage_unconfirmed | fact_unknown | caller_declined | tool_failed | name_missing | ... (when open)",
  "link": { "table": "appointments", "id": "..." },
  "urgent_rule": "safety | payment_dispute | insists_person | repair_fail_3 | frustration | null",
  "created_turn": 7,
  "updated_turn": 9
}
```

`delivery`:

```json
{
  "sms":      { "state": "queued | sent | failed | skipped", "at": "...", "reason": "allowance_exhausted | not_enabled | null", "notify_send_id": "..." },
  "whatsapp": { "state": "...", "at": "...", "reason": "not_configured" },
  "email":    { "state": "...", "at": "...", "reason": null },
  "urgent_sent": ["safety"]
}
```

## State transitions

Record: `open` -> `alerted` (an urgent-now alert or the end-of-call alert was
sent) -> `handed_off` (every open need is handed_off or resolved) -> `closed`
(owner marks done on Desk, or every need resolved). `alerted` -> `open` is not
allowed; a later turn only adds needs or raises urgency.

Need: `open` -> `resolved` (answered on the call or a row was saved and
succeeded) or `open` -> `handed_off` (sent to the owner/teammate). A resolved
need is never reopened by Brain; Desk may reopen (`resolved` -> `open`).
Urgency only goes up during a call: `none` -> `soon` -> `now`.

An immediate alert is the same record: Brain upserts with `urgency='now'`,
Voice sends the alert and writes `delivery` + `status='alerted'`; at hangup
Brain upserts the final needs/summary with `version+1`. Voice sends an urgent
alert only for a rule id not yet in `delivery.urgent_sent` (key
`handoff:<call_id>:urgent:<rule_id>:<channel>`), and the end-of-call summary
once per channel (`handoff:<call_id>:summary:<channel>`). A version bump alone
never sends.

## Who writes what

| writer | writes | when |
|---|---|---|
| Brain | `needs`, `urgency`, `urgency_reason`, `callback_window`, `language`, caller name fields, `returning_caller`, link ids, `summary` | each turn (in memory), upsert on urgent-now and at hangup (`writeHangupSummary`) |
| Voice | `delivery`, `status` open->alerted; end-of-call upsert trigger | alert fires as soon as Brain marks a rule (no speech block); end-of-call hook runs on hangup, socket drop, farewell, outage clip |
| Desk | `status` -> closed, need `resolved`/reopen, owner note | owner action, via RPC |

All writes go through `public.upsert_call_handoff(p_call_id, p_expected_version, p_patch jsonb)` (service_role) or the Desk RPCs. No direct table UPDATE from the client.

## Reuse, not duplicate

- **Notify:** keep `src/notifications/dispatch.js` (SMS -> WhatsApp -> email) and the `notify_sends` ledger. Idempotency keys per decision 11 (`handoff:<call_id>:urgent:<rule_id>:<channel>`, `handoff:<call_id>:summary:<channel>`; never the version). `delivery` is a projection of those rows.
- **Escalate tool:** stays the way a caller-requested human handoff is sent. Its result sets the `human` need to `handed_off`. Change (locked): `validateEscalation` skips the name requirement for urgent alerts only (caller ID phone, `caller_name_source='none'`); non-urgent keeps `missingSlots: ['name']`.
- **SMS allowance:** urgent SMS goes through Ops-Billing's `claim_sms_units(..., p_strict => true)` with the urgent key (decision 4). Brain only reads the outcome.
- **Rows:** `service_requests`, `appointments` stay the system of record; the record links them. `calls.resolution` / `resolution_note` / summary meta stay as they are and are derived alongside (`callResolution.js`, `callSummary.js`).
- **Owner targets:** `team_notify` facts / `alert_email` / `notify_channels` decide recipients; nothing new.

## SQL draft (not applied)

```sql
-- call_handoffs.sql (DRAFT). Run after: contacts_and_requests.sql,
-- appointments.sql, notify_send_ledger.sql, owner_rls.sql.
create table if not exists public.call_handoffs (
  call_id uuid primary key references public.calls (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  status text not null default 'open'
    check (status in ('open', 'alerted', 'handed_off', 'closed')),
  needs jsonb not null default '[]'::jsonb check (jsonb_typeof(needs) = 'array'),
  urgency text not null default 'none' check (urgency in ('none', 'soon', 'now')),
  urgency_reason text,
  callback_window jsonb,
  language text check (language in ('en', 'sw', 'sheng')),
  caller_name text,
  caller_name_source text not null default 'none'
    check (caller_name_source in ('file_confirmed', 'asked_saved', 'none')),
  caller_name_confidence numeric(3, 2) not null default 0
    check (caller_name_confidence between 0 and 1),
  returning_caller boolean not null default false,
  hold_ids uuid[] not null default '{}',
  visit_ids uuid[] not null default '{}',
  request_ids uuid[] not null default '{}',
  summary text check (summary is null or array_length(string_to_array(summary, E'\n'), 1) <= 2),
  delivery jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists call_handoffs_tenant_open_idx
  on public.call_handoffs (tenant_id, urgency, created_at desc)
  where status <> 'closed';
create index if not exists call_handoffs_tenant_created_idx
  on public.call_handoffs (tenant_id, created_at desc);
create index if not exists call_handoffs_needs_gin
  on public.call_handoffs using gin (needs jsonb_path_ops);

alter table public.call_handoffs enable row level security;

-- Owners/teammates of the tenant read their rows. No anon. No client writes.
drop policy if exists call_handoffs_select_member on public.call_handoffs;
create policy call_handoffs_select_member on public.call_handoffs
  for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

revoke all on public.call_handoffs from anon, public;
grant select on public.call_handoffs to authenticated;
grant all on public.call_handoffs to service_role;

-- Versioned, idempotent upsert (Brain/Voice via service_role).
create or replace function public.upsert_call_handoff(
  p_call_id uuid, p_expected_version integer, p_patch jsonb
) returns public.call_handoffs
language plpgsql security definer set search_path = public as $$
declare v_row public.call_handoffs; v_tenant uuid;
begin
  select tenant_id into v_tenant from public.calls where id = p_call_id;
  if v_tenant is null then raise exception 'unknown call %', p_call_id; end if;
  insert into public.call_handoffs (call_id, tenant_id) values (p_call_id, v_tenant)
    on conflict (call_id) do nothing;
  update public.call_handoffs h set
    needs = coalesce(p_patch->'needs', h.needs),
    urgency = coalesce(p_patch->>'urgency', h.urgency),
    urgency_reason = coalesce(p_patch->>'urgency_reason', h.urgency_reason),
    callback_window = coalesce(p_patch->'callback_window', h.callback_window),
    language = coalesce(p_patch->>'language', h.language),
    caller_name = coalesce(p_patch->>'caller_name', h.caller_name),
    caller_name_source = coalesce(p_patch->>'caller_name_source', h.caller_name_source),
    caller_name_confidence = coalesce((p_patch->>'caller_name_confidence')::numeric, h.caller_name_confidence),
    returning_caller = coalesce((p_patch->>'returning_caller')::boolean, h.returning_caller),
    summary = coalesce(p_patch->>'summary', h.summary),
    delivery = h.delivery || coalesce(p_patch->'delivery', '{}'::jsonb),
    status = coalesce(p_patch->>'status', h.status),
    version = h.version + 1,
    updated_at = now()
  where h.call_id = p_call_id
    and (p_expected_version is null or h.version = p_expected_version)
  returning * into v_row;
  if v_row.call_id is null then raise exception 'version conflict on %', p_call_id
    using errcode = '40001'; end if;
  return v_row;
end $$;
revoke all on function public.upsert_call_handoff(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_call_handoff(uuid, integer, jsonb) to service_role;
-- Link arrays (hold_ids, visit_ids, request_ids) are appended by a sibling
-- function, or Brain sends the full arrays in p_patch (decide in review).
-- Urgency is only raised: enforce in the function (none<soon<now) before ship.
-- Desk RPCs (owner close / resolve need / reopen) are security definer with
-- a tenant_id in current_user_tenant_ids() check. Drafted in Desk PR.
```

## Phase 1(b): needs tracker in the brain turn (design)

- `state.needs[]` lives on brain state (already created by Phase 0 for
  coverage). One helper module `src/conversation/needsTracker.js`:
  `openNeed(state, {kind, text, link?, urgent_rule?})`,
  `resolveNeed(state, id, outcome)`, `handOffNeed(state, id)`. Idempotent by
  `kind + normalised text` (Phase 0 dedupes coverage by place).
- Opened from: intent + slots (visit/hold/callback ask), an unknown-fact line
  (GIGO `unknownFactLine` -> `fact_unknown`), coverage (Phase 0), escalate
  intent (`human`), declined or failed tool (`tool_failed`).
- Resolved from: a tool result `succeeded` (link id set), a fact answered from
  the confirmed file, the caller withdrawing ("leave it" -> `resolved`,
  outcome `caller_withdrew`).
- At hangup, every need still `open` becomes `handed_off` in the record and is
  in summary line 2. The prompt gets one line: `OPEN NEEDS: ...` so the model
  does not close the call while one is open.
- Name stays code-held: the tracker never reads a model-written name.

## Phase 1(c): urgent-now rules (design)

An urgent-now rule sets `urgency='now'`, adds `urgent_rule` on the need, and
triggers one immediate alert (record upsert + Voice send, not blocking
speech). The call continues. Until a channel confirms `sent`, the agent may
say only "I'm getting this to the team now"; "the team has been alerted" is
allowed only after the send confirms (speech guard saved-claim rule).

Stable rule ids (stored keys; never change them, labels may change):

| rule id | detects (code, not the model) | default on for playbook |
|---|---|---|
| `safety` | `looksLikeTrueHomeEmergency` (burst, flood, gas, shock, fire, "hatari") + damage words | home_services: on; retail: on |
| `payment_dispute` | double charge, refund demand, "nimekatwa pesa", M-Pesa reversal | all: on |
| `insists_person` | `intent==='human'` asked twice, or one explicit "I want to talk to a person / nataka kuongea na mtu" after a decline | all: on |
| `repair_fail_3` | the assistant's conversation repair counter `state.repair.failureCount` reaches 3 failed in a row | all: on |
| `frustration` | `state.emotion.state` frustrated/angry with intensity high, or two complaint markers | all: **off** (owner can switch on per playbook) |

- Defaults live per playbook (`playbooks/*.js` export `URGENT_DEFAULTS`,
  keyed by rule id). Choosing a playbook in Settings seeds them.
- Owner-editable in Settings as a per-playbook toggle list, stored in
  `tenants.urgent_rules jsonb` as `{ "<rule_id>": true|false }`. A missing
  key = playbook default. Unknown keys are ignored.
- Off-hours do not suppress `safety`. Message-only mode still alerts.
- Channel: email while SMS is off; SMS past the allowance only with on-demand
  on (decision 4).
- At most one immediate alert per rule per call; later turns update the record.

## Flags and rollout

`BRAIN_HANDOFF_RECORD` (exactly 'on'), staging only, scored on replays
(HD_23445a4f780c, HD_ee813bcf6248, HD_015bae4a4af2) before any prod talk.
No vendor names in owner-facing text (summary, alerts). Nothing here invents a
price, coverage, stock, or ETA; a missing fact is a need, not an answer.

## Open questions

For Alvin:

- Beta tenants with on-demand on: get the urgent SMS unbilled (billed 0,
  `would_bill` recorded), unless Alvin wants beta billed. Open; the
  Ops-Billing draft currently records beta on-demand as billed 0.

Implementation follow-ups:

- Ops-Billing: `claim_sms_units` applied to staging, then prod after Alvin's GO.

- Desk: RPC names for close / resolve need / reopen (Desk PR).
- Brain + Voice: link arrays (`hold_ids`, `visit_ids`, `request_ids`) appended by a sibling function, or sent whole in `p_patch`.
- Brain: enforce "urgency only goes up" inside `upsert_call_handoff` before ship.

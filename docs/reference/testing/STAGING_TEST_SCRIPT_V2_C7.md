---
owner: brain
last_reviewed: 2026-10-22
status: reference
---

> **Reference only.** v2 staging test script as written by the Brain lane on 21–22 Oct 2026 for the draft stack. Staging only, never prod; it is not a record of results.
>
> Reference copy of the box brief `briefs/staging-test-script-v2-c7.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Staging test script: v2 C7 "hybrid Gemini tool-calling in SHADOW" (`brain/v2-c7-tools-shadow`)

This draft PR is stacked on #854 (`brain/v2-c2-fact-store`) → #853 → #849 → #848. Platform builds the staging stack.

- **Never on prod.** Only SELECTs on staging.
- No migration: the stage goes into the existing `voice_turn_traces.payload` JSON.
- **The staging Gemini key is Platform's env, not Alvin's.** Nothing on the box has a key or calls Gemini. The agent never read or used one.

## Env Platform must set (voice server, staging)
| Var | Value | Why |
|---|---|---|
| `GEMINI_API_KEY` | **the staging Gemini key, from Platform's own env/secret store** | Without it, shadow switches itself off for the call and logs `[brain_v2_model] no GEMINI_API_KEY; model shadow off for this call`. The caller notices nothing either way. |
| `BRAIN_V2_MODEL` | `shadow` | **C7 (this PR).** Never `on` on staging yet. |
| `BRAIN_V2_MODEL_ID` | optional, default `gemini-3.5-flash-lite` | Model id for the streaming call |
| `BRAIN_V2` / `BRAIN_V2_MODE` | `on` / `live` | v2 live |
| `BRAIN_V2_TENANTS` | `<staging Jirani tenant id>` (the A7 tenant, as in C2) | Scope |
| `BRAIN_V2_COMMIT_SAFETY` / `BRAIN_V2_OWNS_CALL` / `BRAIN_V2_FACT_STORE` | `1` / `1` / `1` | C1, C3, C2 |
| `VOICE_END_CALL_HONOUR` | `on` | C0 |
| `VOICE_TRACE` | on, the same as for the C0–C2 tests | The stage lands in `voice_turn_traces` |

Run one control call (call 9) with `BRAIN_V2_MODEL` unset. It must sound identical to the others and write no `brain_v2_model` stage.

## What the caller should notice
**Nothing.** Every line, read-back, write and goodbye must be exactly what the C2 stack says. There is no extra pause: the model runs beside the rules turn and is never awaited. If a call sounds different from the C2 script, that is a bug. Note the HD id.

## Calls (Jirani, staging)
| # | Lang | Say (in turns) | Expect the trace to show (`brain_v2_model` per turn) |
|---|---|---|---|
| 1 | EN | "How much is a deep clean for two bedroom?" | rules `price`; model `get_price` with a `svc_*` id; agree |
| 2 | SW | "Bei ya deep clean ya vyumba viwili ni ngapi?" | same as 1 |
| 3 | EN | "I want to book sofa cleaning" → "Friday at 10am" → "Karen" → "Aisha" → "Yes" | `book` on every turn. The read-back turn's model call has `allowed` = propose_booking + reads (no `end_call`). On the yes turn, `proposal.commit` is true only if the model passed back the same `confirm_token`. **Exactly one booking is written, by the rules.** |
| 4 | EN | "What time do you open on Saturday?" | `hours` / `get_hours` |
| 5 | EN | "Do you come to Rongai?" | `availability` / `check_availability` |
| 6 | SW/Sheng | "Nataka kubook carpet steaming kesho" (a service not on the list) | the rules line for an unknown service. If the model proposes an invented id, the trace shows `proposal.error = unknown_service` and nothing is written. |
| 7 | EN | "Call me back on 0700 000 002" | rules `callback`. **The stage and the logs show `[phone]`, never the digits.** |
| 8 | EN | "Thanks, bye" | `end` / `end_call`, then the goodbye as before |
| 9 | EN | control, `BRAIN_V2_MODEL` unset: repeat call 1 | the same line as call 1; no `brain_v2_model` stage |
| 10 | EN | repeat call 3 at a busy moment | look for any `timedOut: true`. On those turns the caller still heard the rules line straight away. |

## Check (SELECT only, staging)
```sql
select t.call_id, t.turn_index, t.created_at,
       s->>'agree' as agree, s->'rules'->>'intent' as rules_intent, s->>'modelIntent' as model_intent,
       s->'proposal'->>'tool' as tool, s->'proposal'->>'error' as tool_error, s->'proposal'->>'commit' as commit,
       (s->>'latencyMs')::int as ms, s->>'timedOut' as timed_out,
       s->'tokens'->>'in' as tok_in, s->'tokens'->>'out' as tok_out, s->'tokens'->>'costUsd' as usd
from voice_turn_traces t
cross join lateral jsonb_array_elements(t.payload->'stages') s
where t.record_kind = 'turn' and s->>'stage' = 'brain_v2_model'
  and t.created_at > now() - interval '1 day'
order by t.created_at, t.turn_index;
```
To check for raw phone numbers, this must return 0 rows:
```sql
select t.call_id from voice_turn_traces t
cross join lateral jsonb_array_elements(t.payload->'stages') s
where s->>'stage' = 'brain_v2_model' and s::text ~ '(\+?254|0)7[0-9]{2} ?[0-9]{3} ?[0-9]{3}';
```

## Score it
Export the full rows (`select t.call_id, t.turn_index, s as stage …`, the query in `docs/explanation/brain/v2-model-shadow.md`) as JSON. Then run:
```
npm run -s eval:v2:shadow-agreement -- staging-c7.json
```
It reports agreement overall and by rules intent, p50/p95/max latency, the timeout rate, invalid proposals, average tokens, cost per turn and per call, and the gate verdict.

**The rollout gate is for later, not for this run.** Before `on` is considered, the shadow set needs:
- at least 95% agreement;
- p95 under 900 ms (architecture target: p95 < 800 ms and p50 ≤ 650 ms).

`on` would then apply only to turns the rules left unclear, with Alvin's sign-off. This 10-call run is a smoke test. The gate needs a larger shadow set.

Send back:
- the HD ids;
- the eval output;
- any turn where the caller heard something different from C2, or where a write happened without a yes;
- any row with a raw phone number.

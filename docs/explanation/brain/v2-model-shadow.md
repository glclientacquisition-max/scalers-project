---
owner: brain
last_reviewed: 2026-10-21
---

# Brain v2: hybrid Gemini tool-calling, in shadow (C7)

Status: **shadow only.** `BRAIN_V2_MODEL` defaults to `off`. `shadow` is the only mode for staging.
`on` exists in code but is **not for staging yet**. Use it only after the rollout gate below passes and Alvin signs off.

This revives the design from closed PR #536 (native `functionDeclarations`, code decides whether a visit exists, tool payloads are never spoken, no legacy markers). The branch itself is not reused. It follows plan section A (A1–A3), row C7 and `/workspace/briefs/ba-architecture-v2.md`, phase 2.

## What runs

| `BRAIN_V2_MODEL` | Caller hears | Model |
|---|---|---|
| unset / `off` / anything else | rules (v2 machine) | not called |
| `shadow` | rules, byte-identical to `off` | called beside the rules turn, never awaited, logged per turn |
| `on` (exact value only, **not for staging**) | rules; the model is consulted only when the rules found no intent | same capped call, handed to the machine's existing `consultModel` hook |

Code: `src/conversation/v2/modelShadow.js` (tools, validation, request, agreement, cost), `createGeminiStreamModel` in `src/conversation/v2/transport.js` (streaming), and `resolveModelShadow` plus `run()` in `liveTurn.js` (wiring). `voiceTrace.noteBrainV2Model` writes the stage to the trace.

## One model call

- **Transport.** `POST models/<id>:streamGenerateContent?alt=sse` with native function calling. The key travels only in the `x-goog-api-key` header and is never in the URL or in error text.
- **900 ms hard cap.** An `AbortController` cancels the call at 900 ms (`capped`). A timeout or error comes back as a result, never as an exception. The rules line is the fallback, and in shadow it is always the line spoken anyway.
- **Request.** It carries:
  - a system instruction;
  - a `CONTEXT` block with the time in EAT and the machine state: `phase`, `intent`, `expecting`, `lang`, slots, the read-back waiting and its confirm token;
  - facts from the C2 fact store (`factsFor(profile)`): service, product, area and FAQ ids and names, plus the typed price the server would say;
  - up to 6 previous caller turns;
  - **only the tools allowed in this state**.

  Settings: temperature 0.1, `maxOutputTokens` 160, thinking `MINIMAL`. The caller's text is phone-redacted before it is sent.
- **thoughtSignature.** A function-call part keeps its `thoughtSignature`. The next turn's history sends it back unchanged with the server's validated `functionResponse`.
- **Model text is never spoken.** Any text the model returns is dropped (`[model text dropped]`).

## Tools: typed proposals only

| Tool | Kind | Notes |
|---|---|---|
| `propose_booking` | write | `service_id` is an enum of fact-store ids; `when{date YYYY-MM-DD, time HH:MM}`, `place`, `name`, `confirm_token` |
| `propose_order` | write | `items[{product_id enum, qty}]`, `pickup` |
| `propose_quote` | write | for a service with no typed price |
| `propose_callback` | write | `reason` enum |
| `get_price`, `get_hours`, `check_availability`, `lookup_file` | read | `lookup_file.row_id` is an enum of the caller's own open rows |
| `end_call` | control | the server plays the goodbye |

**Per-state lists.** After the call has ended, no tools are allowed. While a read-back is waiting, only that write (to confirm with its token) and the read tools are allowed, and `end_call` is not. Otherwise, all tools are allowed.

`validateProposal` checks every call. Each failure is a result the model sees next turn, never a throw:

- `unknown_tool`
- `not_allowed_in_state`
- `schema_invalid`
- `unknown_service` / `unknown_product`: an id that is not in the fact store, such as a hallucinated service
- `token_mismatch`

A write with no `confirm_token` is `{ok, commit:false}`: it only proposes, and the server reads it back. Only the C1 confirm token, minted on the caller's explicit yes and present in a read-back, gives `commit:true`. **In shadow nothing is ever committed or written** either way, because the server templates speak and the rules own every write.

## Shadow: zero added latency

`begin()` takes a snapshot of the machine before the rules turn. That snapshot is the only synchronous work. Building the facts and the request, and the model call itself, start on the next tick. `finish()` runs after the rules turn and is not awaited by `run()`. The comparison and log happen when the model answers or hits the cap. Shadow never touches the machine state, the history the rules use, writes, or the spoken line. The tests show this on an 8-turn call: lines, writes and state are byte-identical to `off`, and a 1.5 s stand-in leaves the caller's turn under 400 ms.

## Per-turn log

The trace stage goes to `voice_turn_traces.payload.stages[]` on the same turn row (`record_kind='turn'`). If the stage lands after the turn row was written, it updates that row through `sink.update`. It also appears as a `[brain_v2_model] ...` log line. Fields:

`stage='brain_v2_model'`, `mode`, `model`, `turnIndex`, `allowed`, `rules{intent, slots}`, `proposal{tool, args, valid, error, commit, extraCalls}`, `modelIntent`, `agree`, `intentAgree`, `slotDiffs`, `latencyMs`, `timedOut`, `error`, `capMs`, `tokens{in, cached, out, thoughts, estimated, costUsd, costKes}`, `thoughtSignature` (true or false only; the signature itself is not stored).

**No raw phone numbers.** Runs of 7 or more digits become `[phone]` in the stage and in the request. The trace redactor runs again as a backstop. ISO dates are kept. For `name`, the stage records only `set`.

**How agreement is scored.** The rules intent is derived from the turn, in this order:

1. end of call → `end`;
2. a read-back opened → its write intent;
3. a yes that committed;
4. an info answer: `price`, `hours`, `availability`, `recall`;
5. otherwise the open intent.

Small-talk and FAQ turns count as `none`. A turn agrees when the intents match and no slot the two sides both filled differs. The slots compared are service, date, time and items. A timeout or error never counts as agreement.

### SELECT (staging, read-only)

```sql
select t.call_id, t.turn_index, t.created_at, s as stage
from voice_turn_traces t
cross join lateral jsonb_array_elements(t.payload->'stages') s
where t.record_kind = 'turn'
  and s->>'stage' = 'brain_v2_model'
  and t.created_at > now() - interval '7 days'
order by t.created_at, t.turn_index;
```

Export the result as JSON or JSONL (one row per line), then run:
`npm run -s eval:v2:shadow-agreement -- rows.jsonl`. Add `--json` for machine-readable output. Without a file, the script scores the bundled fixture.

The script reports:

- agreement overall and by rules intent;
- intent-only agreement;
- p50, p95 and max latency (a timeout counts at its capped latency);
- timeout and error rates;
- invalid proposals;
- average tokens;
- cost per turn and per call;
- the gate verdict.

## Rollout gate (before `on`)

1. Stage `BRAIN_V2_MODEL=shadow` on staging and log that the model agrees with the rules.
2. **Gate:** on the shadow set, **at least 95% agreement and model p95 under 900 ms**. The architecture doc's phase 2 target is p95 < 800 ms, and the p50 target is ≤ 650 ms. Both are read from `eval:v2:shadow-agreement`. Look at the disagreements by intent before signing off.
3. Only then, with Alvin's sign-off, set `on`, and only for turns the rules left unclear (no intent). Proposals still go through `validateProposal`, the read-back and the confirm token. Templates still speak.
4. Retire `classifyAsk` once `on` covers the unclear turns.

Today `on` uses the machine's existing `consultModel` hook with its older request shape. Wiring it to the new tools is part of step 3 and is out of scope here. Until then, `on` is **not for staging**.

## Cost estimate

Prices for Flash-Lite are $0.30 per million input tokens, $0.03 per million cached and $2.50 per million output.

Input token counts come from the real request builder. Each count is the request JSON length divided by 4. Staging `usageMetadata` replaces these estimates (`tokens.estimated=false`).

| Tenant shape | Turn 1 in | Turn 7 in (6 turns of history) |
|---|---|---|
| 2 services | ≈1,180 | ≈1,950 |
| 8 retail products (Aris fixture) | ≈1,440 | ≈2,190 |
| 40 services + 10 FAQs | ≈2,310 | ≈3,100 |

Output is about 20–40 tokens: one function call, with thinking set to minimal.

| | Per turn | 12-turn call | KES per call (129/USD) |
|---|---|---|---|
| Typical (≈1,800 in / 30 out) | ≈$0.00062 | ≈$0.0074 | ≈KES 0.96 |
| Large catalogue (≈3,100 in / 40 out) | ≈$0.00103 | ≈$0.0124 | ≈KES 1.6 |

With implicit caching of the system plus facts prefix, which is most of the input, a typical call drops to about KES 0.4–0.6. Timed-out calls are still billed at their estimated input.

## Env

- `BRAIN_V2_MODEL` = `off` (default) | `shadow` | `on`. `on` is not for staging.
- `BRAIN_V2_MODEL_ID`: optional, defaults to `gemini-3.5-flash-lite`.
- `GEMINI_API_KEY`: Platform's env on staging. Without it, shadow turns itself off for the call and logs that. It never reads a key file.
- The rules path needs the C3/C2 flags as before: `BRAIN_V2=on`, `BRAIN_V2_MODE=live` and, if they are being tested together, `BRAIN_V2_OWNS_CALL`, `BRAIN_V2_COMMIT_SAFETY` and `BRAIN_V2_FACT_STORE`. The shadow builds its facts with `factsFor(profile)` whether or not `BRAIN_V2_FACT_STORE` is set.

## Limits

- The model's history is kept per call, on the live runner. If a turn's model answer arrives after the next turn has started, that next request will not include it.
- On a reconnecting media session, an owned v2 runner keeps the first session's trace hooks.

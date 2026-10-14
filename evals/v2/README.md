# BA v2 Phase 0 eval harness (tau2-style)

Text-level harness for the Business Assistant Brain. It scores **final DB state + spoken
assertions** with **pass^k (k=4)**, in-process against any build checkout. No network, no
DB writes: tools write into a fake tenant DB seeded from the scenario.

| Path | What |
| --- | --- |
| `run.js` | Scenario suite runner: `node evals/v2/run.js --root <checkout> --label <name> --flags prod\|staging\|staging+ci --k 4` |
| `replay.js` | Real-call replay runner over `fixtures/replay/*.json` (`--labelled` for the human-labelled set) |
| `convert-calls.js` | Real call → replay fixture (call + transcript + `voice_turn_traces` → turns, recorded model output, observed rows, expected end state) |
| `baseline.sh` | Baseline matrix: main / curated staging / live staging × noisy and clean model |
| `live-latency.js` | Live latency percentiles from staging turn traces |
| `lib/driver.js` | Brain turn loop (mirrors `tests/helpers/brainSimulator.js` + the BRAIN_TRUST_P1 hooks in `server.js`), fake DB, Brain-only timing |
| `lib/model.js` | Seeded model stand-in (marker protocol) with a per-turn fault rate (`EVAL_FAULT_RATE`, default 0.3) |
| `lib/persona.js` | Scripted caller personas (EN / SW / Sheng variants, reactive slot answers, says yes to read-backs) |
| `lib/score.js` | Build-independent scorer (own EN/SW lexicons) |
| `scenarios/suite.js` | 25 scenarios from the caller-info audit eval list |
| `fixtures/tenants/` | Done and Dusted (staging config), a synthetic retail shop, two prod retail tenants |
| `fixtures/raw/` | Read-only SELECT exports (staging calls, traces, prod calls) |
| `fixtures/replay-labels.json` | Human labels (expected end state) for the named regression calls |

Pass criteria per run: expected rows (appointments, service_requests, handoff, complaint,
contact name, row statuses, untouched rows), no false claim (commit/booked without a
succeeded tool this turn, stock/availability without a receipt, transfer, refund promise,
invented history, another person's name, instruction text spoken), owner email free of
instruction text, reply language matches the caller, ≤35 words and ≤1 question per turn, and
for commitment scenarios a read-back question followed by the caller's yes before every
commit write (Alvin's decision for v2).

No LLM key is configured on the box, so callers are scripted personas and the model side
is a seeded stand-in, not Gemini. `EVAL_PERSONA=llm` is reserved for an LLM persona.

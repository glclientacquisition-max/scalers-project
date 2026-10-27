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
| `lib/heard.js` | Heard-audio metrics from `runTurnStream` events (what the caller hears): repeated turns, ack-led, filler-only turns, fragments ("Hapana, n"), language match, tool-turn gaps. Gated in `bar.js` |
| `lib/score.js` | Build-independent scorer (own EN/SW lexicons) |
| `scenarios/suite.js` | 50 scenarios (S36-S50: EN/SW pairs for outside-Nairobi, callback→booking supersedes, escalate receipt-first, what's-my-name, cut-off fragments, place-given-as-name); originally 25 from the caller-info audit eval list |
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

## Edge-case sweep (`edge/`)

| Path | What |
| --- | --- |
| `edge/gen.js` | Combinatorial + seeded generator: ~240 base cases over dates/times (kesho 00:00-05:59, keshokutwa, weekdays, this/next Friday, next week, Swahili vs English clock, saa mbili 08:00/20:00, AM/PM, closed day, holiday, past time), names vs places, nicknames, spelled names, landmarks, phone numbers, ASR noise/silence/hold, barge-in, self-corrections, change after read-back, multi-intent, cancel/update, in-county estates (Ruaka in Kiambu), out-of-area towns, off-catalogue services, "are you a bot", rude callers. Each case has a fixed clock, persona language, the exact STT line plus 3-5 CheckList-style variants (ASR casing, disfluency, typo, code-switch greeting) and an expected booking row or clarifying question. |
| `edge/paraphrase.js` | Optional Gemini paraphrases of the synthetic openings (no call data), cached in `edge/paraphrases.json` |
| `edge/run.js` | `node evals/v2/edge/run.js [--expand] [--k 4] [--show 1]`: pass^k on BRAIN_V2, failures clustered by root-cause family x failure signature. `--expand` runs every variant as its own case. |

Templates borrow test themes from Duckling (BSD) / SUTime and CheckList (MIT); no code or data copied.
Audio variants (TTS + 8 kHz telephone noise, DTMF, real barge-in timing) are not covered here.

## Regression-9 (`regression/`, `npm run test:bugs`)

The nine known bugs from the Oct 15-16 calls as permanent EN + SW cases (synthetic, fixture
tenants, no call data). `node evals/v2/regression/run.js --flags v2 --k 4` exits 1 on any FAIL.
Voice-side bugs (6-9) are probes marked `xfail` with an owner note: XFAIL and XPASS never fail
the run; an XPASS means the owner can drop the xfail. Offline: no network, DB, model key or
SAUTIKIT_API_KEY. Platform's CI gate (#718, check `bug-test-pack`) runs `npm run test:bugs`.
Also in the pack: synthetic replays of the Brain-owned causes from the Jirani staging call
HD_b4396ad63677 (JB1 facts not single-sourced, JB2b post-check line deletion, JB4 saved contact
name, JB5 "pickup" as hold, JB8 greeting wording) on `fixtures/tenants/synthetic_cleaner.json`
(fictional tenant, same spoken-doc shape). Read-back cues shared by the persona and the write
check live in `lib/readback.js` (incl. SW "Nipeleke/Tupeleke/Nitume ombi…?"; not "nikutumie").

---
owner: brain
last_reviewed: 2026-10-24
---

# Phase B call fixes (staging call HD_b4afd63a69c3, 24 Oct 2026 13:08 EAT, tip 3373d591)

RCA: `voice-qa/2026-10-24_flow-and-call.md`. Done when a replay of the 13:08 call books: `tests/brainPhaseBCallFixes.test.js` REPLAY.

## Fixes
1. **Area coverage** (`src/conversation/v2/areaCoverage.js`). `resolve(text, profile)` binds the spoken place against the shared Kenya tree (`data/kenyaPlaceCounties.json`, same as Desk `coverageAreas.ts`), using fuzzy STT spellings (Kilelesha, Kileleshua, Kileleshwani) and a small landmark seed (Sarit to Westlands, Yaya to Kilimani, and so on). It then applies the owner's rules: an exclude beats an include, and a county include covers its places. Outcomes, with every line `[PROMPT-PLACEHOLDER]`:
   - covered: "Yes, we cover X." / "Ndio, tunafika X."
   - excluded or outside: "Sorry, we don't cover X." / "Samahani, hatufiki X."
   - unknown: "Which area is that near?" / "Hiyo iko karibu na eneo gani?" It never says "I don't have that detail".

   When the caller asks a question while a slot is open, the question is answered and the step is asked again. The question is never stored as the slot.
2. **The fact check trusts call state.** Auto facts are always cited: the area facts `AR*` (resolved place, county, covered) and the booking fact `K1` (the caller's service, date, time, place and confirmed name, or the last ok write receipt). Made-up places, prices and other times are still replaced.
3. **Replacement under the plan.** The reply is never "unknown line + plan.tail()". If the replaced sentence is about the booking, the plan template is spoken in full. Otherwise the reply is the unknown line plus the callback offer. Either way there is one ask.
4. **A yes at the read-back books** ("Yeah, I do so", "Ndio, sawa", "Sawa"). "Yes but …" and "Ndio lakini …" do not book. At turn end, a short yes-led answer to our question is whole and is not held (`unfinishedTurn` short_yes).
5. **Latency.** Under Phase B the draft starts at turn start, in parallel with CP.before, the understanding call and the machine. Its sentences are buffered and only spoken through the plan gate. They are verified against the post-plan state. The partial early start is re-allowed under B, and it also warms the understanding call. Knob: `BRAIN_V1_DRAFT_PHASE_B_PARALLEL=off` restores serial. Trade-off: the early draft request has no STEP note, so actCheck and the tail enforce the step.

## Desk contract proposal (Desk to agree; Desk is not changed in this PR)
```
service_areas.areas[] = { id: 'county:<slug>' | 'place:<slug>', rule?: 'include' | 'exclude' }   // default include
service_areas.exclude?: string[]   // shorthand list of place/county slugs
```
- Slugs come from the same Kenya tree. Desk can add the rule as a chip toggle on the existing coverage picker. Rows with no rule keep today's meaning, so no data migration is needed.
- Brain reads both shapes. It canonicalises spellings (kibera to kibra) and speaks the owner's spelling.
- Landmarks are a Brain seed for now. They could later become an owner list: `service_areas.landmarks[] = {name, place}`.

## Latency (sim, not production)
`node evals/sim/phaseBLatency.sim.js 200` measures run() to the first sentence. It does not include STT endpointing, network or TTS. The model delays are assumed: draft ~ lognormal with median 900ms; understanding U[250,750]ms; partial lead U[0,400]ms.

| mode | p50 | p90 | max |
|---|---|---|---|
| serial (before) | 1559ms | 2031ms | 2795ms |
| parallel | 902ms | 1449ms | 2843ms |
| parallel + partial | 814ms | 1267ms | 1617ms |

These need confirming on staging traces before anyone claims a sub-2.0s p90.

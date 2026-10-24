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

## Area source: Desk's tenant_area_picks (supersedes the earlier service_areas.areas[] proposal, 24 Oct 2026)
On the Chief's decision, Desk #930 is the single source. It provides `public.tenant_area_picks`, the tree `dashboard/src/lib/data/kenyaAreaTree.v1.json` (`ke-areas-2026-10-24.1`, 163 areas, with aliases and landmarks) and the contract `docs/reference/platform/AREA_PICKS.md`. The `service_areas.areas[]{rule}` proposal is dropped. The PR `brain/coverage-area-picks` makes these changes:
- **Loading:** `db.loadAreaPicks` reads `tenant_area_picks.picks` in its own query and attaches it as `profile.areaPicks`. If the table is missing or the query errors, it returns null and the call still loads.
- **Shared code:** `src/conversation/v2/areaPicks.js` is a CommonJS port of Desk's `areaPicks.ts` (`normalizeAreaPicks`, `resolveArea`, `matchAreaText`, `callerHears`). It reads Desk's tree file directly, and the Dockerfile copies `dashboard/src/lib/data` into the Voice image, so Brain keeps no tree of its own. Brain's landmark seed list is removed.
- **Parity:** `tests/brainAreaPicks.test.js` runs Desk's TS and Brain's JS on 30 places and asserts the same status, line and node. It needs node ≥ 22.6, or `NODE_TS` set.
- **Resolving a place:** `areaCoverage.resolve` finds the place phrase in the caller's words, using exact name or alias, then landmark, then loose spelling (≤1 edit at 4 letters, ≤2 at 5+), plus the sw locative "-ni". The nearest pick wins:
  - a serving pick means covered, and fee and note come from the nearest serving pick that sets them;
  - an explicit `serve:false` pick means excluded;
  - no pick on the path means outside;
  - no node matched gives "Which area is that near?".
- **What the caller hears:** Desk's "what callers will hear" lines. A fee or note is always heard, followed by the open step. All lines are [PROMPT-PLACEHOLDER].
  - EN: "Yes, we cover X. There's an extra KES N. {note}." / "Sorry, we don't cover X." / "Which area is that near?"
  - SW: "Ndio, tunafika X. Kuna ada ya ziada ya KES N. {note}." / "Samahani, hatufiki X." / "Hiyo iko karibu na eneo gani?"
  - TTS speaks the money as words.
- **Fallback:** the legacy lists (`service_areas` / `serviceAreas` / `areaTerms` / `coverage_areas`) are used only when the tenant has no picks, the tree file is absent, or `BRAIN_AREA_PICKS=off`.
- **Known gap (Desk parity):** a bare "Sarit" is not on the map, because Desk matches only the full landmark "Sarit Centre". Brain gives the same answer as the preview. The fix belongs in the Desk tree (add the short landmark or alias), not in a Brain list.

## Latency (sim, not production)
`node evals/sim/phaseBLatency.sim.js 200` measures run() to the first sentence. It does not include STT endpointing, network or TTS. The model delays are assumed: draft ~ lognormal with median 900ms; understanding U[250,750]ms; partial lead U[0,400]ms.

| mode | p50 | p90 | max |
|---|---|---|---|
| serial (before) | 1559ms | 2031ms | 2795ms |
| parallel | 902ms | 1449ms | 2843ms |
| parallel + partial | 814ms | 1267ms | 1617ms |

These need confirming on staging traces before anyone claims a sub-2.0s p90.

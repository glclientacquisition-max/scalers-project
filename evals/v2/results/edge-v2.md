# BA v2 edge-case sweep (evals/v2/edge), 15 Oct 2026

Generator: 238 base cases (seed 7), each with a fixed clock, persona language (EN/SW/Sheng), exact STT line plus 3-5
CheckList-style variants and 2 cached Gemini paraphrases (5 Gemini calls, synthetic text only). `--expand` = 1,392
variant cases; all at pass^4 (5,568 runs). Scripted persona + seeded model stand-in (fault rate 0.3).

| | base cases pass^4 | expanded variants pass^4 |
|---|---|---|
| Before (8e448cb0 Brain, same harness) | 90/238 (37.8%) | 553/1392 (39.7%) |
| After | 236/238 (99.2%) | 1387/1392 (99.6%) |

Phase 1 bar: 21/21 PASS after the fixes. Labelled replays unchanged (pass^k 71.3%); replay language match 0.9575 (unchanged).

Remaining: 5 variants where a Swahili-paraphrased opening is followed by English answers ("10am", "Yes please")
and the Brain stays in Swahili (sticky language; code-switch follow).
Not covered (needs audio): TTS + 8 kHz telephone noise, matatu/background noise, DTMF, real barge-in timing, ASR mis-hearings of names/places.

## Follow-up (explicit yes, next Friday, closing time)
Suite S56-S61 added (echo instead of yes EN/SW/Sheng, next Friday EN/SW, right-now near close); they failed on 51e7be7f and pass now.
Edge: 246 base cases 245/246 pass^4; 1,406 variants 1,404/1,406. Bar 20/21: HD_212 replay now fails by design
(the recorded caller repeats "saa 4" at the read-back and the call ends, so v2 asks yes/no and writes nothing; the label expects a booking).

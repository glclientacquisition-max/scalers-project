# BA v2 Phase 1: scripted results (BRAIN_V2=on, mocked function-calling model)

Clock: Wed 14 Oct 2026 08:00 EAT. k=4. Model = `lib/fcModel.js` (seeded, fault rate 0.3). No Gemini key.

| Bar item | Target | Result |
|---|---|---|
| Booking pass^4 (commitment scenarios, all rules) | >=90% | 100% (13/13) |
| HD_212 replay | pass | pass (1 appointment Fri 16 Oct 10:00, no hold row, name not re-asked) |
| Suite pass^4 | >=85% | 100% (25/25) |
| Read-back + yes on commitments | 100% | 100% |
| False claims (suite + 87 replays) | 0 | 0 |
| Owner-email leaks (suite + replays) | 0 | 0 |
| Brain p95 on tool turns | <=300 ms | 0.45 ms (local; excludes model) |
| SW/Sheng language match (suite) | >=98% | 100% (108 turns) |

Robustness: suite pass^4 = 100% at model fault rate 0, 0.3, 0.6 and 1.0.

Replay (informational, 87 real calls, mocked model): pass^k 51.7% (main 28.7%), labelled 4/7 (main 3/7),
end-state 78.2% (main 79.3%), SW/Sheng match on replays 63.8%. Flag off: suite numbers equal the Phase 0 main baseline
(4% / 23.1% / 11.58%).

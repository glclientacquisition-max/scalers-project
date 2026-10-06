# Turn-end policy

One function, `decideTurnEnd` in `src/speech/turnEndPolicy.js`, decides whether a caller turn flushes into Gemini.

| Signal | Action | Wait |
| --- | --- | --- |
| Soniox `finished` | Flush now | 0 |
| Soniox `endpoint` and the turn is complete | Flush now | Soniox already waited `SONIOX_MAX_ENDPOINT_DELAY_MS` (default 700) |
| Soniox `endpoint` and the turn is unfinished | Hold, then the local flush | endpoint + 450ms, clamped to `VOICE_FLUSH_MIN_MS`..`VOICE_FLUSH_MAX_MS` (default 300..1200) |
| No endpoint (timer only) | `adaptiveFlushMs` | Complete sentence caps at 480ms. Unfinished uses the same hold as an endpoint. |

Unfinished means any of:

- trailing comma (`Ah, nilikuwa nauliza,`)
- trailing dash
- a continuation tail or auxiliary from the language packs (English, Kiswahili, Sheng), including `nauliza` and `nilikuwa`

A finished sentence may contain an internal comma (`Sawa, nimehifadhi ombi lako.`). That flushes. Callers code-switch, so tails from every pack apply on the same turn. The hold never exceeds `VOICE_FLUSH_MAX_MS`.

# 2026-10-24 v1 vs v2 model handling (read-only)

v1 = prod tip `3bb1d0e3` (`server.js`, `src/conversation/geminiVoice.js`). v2 = staging C7 `f120677b` (`src/conversation/v2/*`).
Data: prod Supabase `fjxcdccgyhnvnnlnovcl` `voice_turn_traces`, last 30 days (2026-10-09 → 10-22). Staging data is from the 2 calls in the root-cause note. Nothing was changed.

## Side by side
| Dimension | v1 (prod) | v2 C7 (staging) |
|---|---|---|
| Call shape | **Streaming** `generateContentStream` (`server.js:7184`). Text deltas go to a sentence buffer and TTS chunks are spoken as they arrive (`server.js:7196-7215`, `spokenStreamBuffer.js:256`). | Streaming SSE transport exists (`transport.js` C7 adapter), but the mouth reads the cascade result only as a whole proposal raced against 750 ms (`machine.js:740-770`). No partial result is usable. |
| Client | **One process-wide `GoogleGenAI` singleton** (`server.js:621-629`), so connections stay warm. | Raw `fetch` per call via `createGeminiSend` (`transport.js:7-21`). Node's global keep-alive pool may reuse sockets, but there's no warmup and nothing measures it. |
| Prompt | Big system prompt (`prompts.js` ≈28.5 KB) + 16-message window (`geminiVoice.js:6`). Facts are added per turn as a short directive (`server.js:4117-4124`). Tokens are **not logged** (unavailable). | About 4.4–4.6k input tokens per turn, `cached:0` (traces). Static system prompt + catalogue rebuilt each turn (`modelShadow.js:96-135`). |
| Context caching | None. | None. |
| Start time | After turn-taking decides `runGemini` on the final (`turnTaking.js:575-809`). Not on partials. | After the merged final, including unfinished-hold merges of +1600 ms each. Not on partials. |
| Timeout / backup | **One stream, 8000 ms wall** (`geminiVoice.js:7`). On timeout/error, **retry the same model after 400 ms**. **Backup only on 503/rate-limit**. Stop if any text was already spoken (`geminiVoice.js:251-266`). There's no artificial split budget: the retry or backup gets a full window. | Serial primary 1470 ms → backup about 330 ms inside an 1800 ms cap (`modelShadow.js:203-214`). Backup structurally can't finish. |
| Calls per turn | **1** (plus a retry only on failure). | Up to about 5: shadow cascade (2) + machine cascade (2) + classify (`liveTurn.js:159-172`). |
| Who speaks | **Model prose is the mouth.** Deterministic pre-model paths return first: visit read (`server.js:4100-4114`), catalogue ("Gemini does not own that list", `server.js:4116`), file-lookup sentence (`suppressModelSpeech`, `server.js:4073`). Action turns speak the backend confirmation, not model prose (`geminiVoice.js:274-293`). | Templates only. The model proposes and the machine speaks a template. |
| Multi-ask | One generation can answer several asks and emit several `###TOOL###` markers (prod sample: `save_caller_info` + `create_service_request` callback in one output, parsed by `toolMarkers.js`). | First-match-wins router, one template per turn (`machine.js:987` etc.). |

## v1 numbers (prod, 30 days, 106 calls)
- Caller stop → model first token: **p50 1100 ms, p90 1383 ms, p99 2627 ms** (n=362 turns with the field).
- First reply PCM: p50 1787 ms, p90 2408 ms (n=537).
- Outcomes (n=537): ok 285, barge_in 126, hold 47, early_return 41, **stream_fallback_full 11 (2.0%, the proxy for timeout/failure fallback)**, call_end 14, skip 7, speech_repair 5, speech_quiet 1.
- Model `request` 434 vs `output` 370 phases: 64 (14.7%) requests have no output stage. Barge-aborts and failures can't be told apart in the trace, so this is **not** a timeout rate.
- **Unavailable:** per-turn tokens, per-model latency split, retry/backup counts (only in Railway stdout as `Gemini stream retry/backup`; not pulled).
- v2 for contrast (n=7 model turns, 2 calls): primary 780–1279 ms when it answers, **2/7 dual timeouts at 1800 ms**.

**Takeaway:** v1's model is not faster: first token p50 is about 1.1 s, the same band as v2's primary. v1 still worked for three reasons:
1. It never hard-cut a healthy-but-slow call: 8 s wall, a fair retry, backup only for capacity errors.
2. It streamed, so speech started at the first sentence.
3. It made one call per turn.

## What v1 did badly — must NOT return
- **Freeform model speech as the mouth.** That is where invented coverage, prices and availability came from. The guard stack proves the risk: `stripSpokenInstructionLeaks` (`geminiVoice.js:4`), `noAiSlop.js`, `glueRepair.js` (drops unrepairable sentences), `gateCallerFileSpeech`, the 25-word / "read the catalogue from the file" rules in `prompts.js:41-51`.
- **Facts carried by the prompt.** Grounding was a 28 KB instruction blob, with no system check that a spoken price or area exists in the file.
- **Tool calls as text markers** (`###TOOL###`), plus prompt nudges like "Append the … marker now" (`requiredCreateRequest.js:519`, `requiredEscalate.js:110`). The control flow lived in prose.
- **Model-decided callbacks.** The prod sample shows the model opening a `callback` request for a stock/price question on its own judgement.
- **Spoken-chunk leakage on abort:** stream text already spoken can't be retracted (`geminiVoice.js:258` "spoke → stop").

## Ranked mechanisms to borrow (each fits: model extracts/proposes → system resolves → system speaks)
1. **One model call per turn with a fair failure policy** (`geminiVoice.js:251-266`). Retry the same model once only on timeout/error, and fall back to the backup only on 503/rate-limit. Don't split one cap into a starved backup.
   - *Fit:* the resolver issues one extraction request per turn and cancels the previous turn's. Wall time can be generous because the system already holds the floor: a filler, or a template from rules-only extraction plus resolution while the model refines.
2. **Streaming consumption** (`server.js:7184-7215`). v2 should stream **structured output** (function-call args / JSON fields), not prose. The resolver acts on the first complete field, e.g. `place=Kisumu` → area check, without waiting for the whole payload.
   - *Fit:* the model's fields feed `TurnAsk` incrementally, and the system composes from resolutions.
3. **Process-wide warm client** (`server.js:621-629`). Use one long-lived client or agent per process, and pre-warm at call start (v1 already warms greetings: `greetingWarm.js`).
   - *Fit:* transport only, no speech impact.
4. **Deterministic answer paths return before the model** (`server.js:4100-4116`, "Gemini does not own that list"; file lookup `server.js:4073`). That is v1's own "system owns facts" seam. Generalise it: every resolvable ask (catalogue, price, area, visit status) is answered by the resolver, and the model is only asked for what rules couldn't extract.
5. **Backend speaks the action outcome** (`spokenTextForToolTurn`, `geminiVoice.js:274-293`). Model prose never confirms a booking or callback. Keep this as a hard rule: the resolver's commit result is the only source of confirmation lines.
6. **Multi-intent output in one generation** (multiple tool markers per turn). Borrow the *shape* (several proposals per turn: `[{ask:explain, service}, {ask:area, place}, {ask:feasible}]`), not the text markers. Use native function calls / JSON schema.
   - *Fit:* this is exactly the `TurnAsk` set the resolver needs to answer every ask in the turn.
7. **Bounded history window** (`CONTEXT_WINDOW=16`, `geminiVoice.js:6`), plus a short per-turn fact note (`server.js:4117-4124`) instead of the whole catalogue every turn.
   - *Fit:* send the model a compact entity vocabulary (service/area names only). Prices and notes never go to the model because the system speaks them. That shrinks the about 4.4k prompt, and the static prefix becomes cacheable.

Not borrowed: free prose as the mouth, prompt-carried facts, model-decided callbacks, text tool markers.

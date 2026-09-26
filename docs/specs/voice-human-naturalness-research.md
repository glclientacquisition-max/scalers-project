# Research: human voice, not robotic

**Status:** Research plus Voice runtime for cache path and remaining leak prose.  
**Lane:** Voice. Brain owns wording. Do not retune `SONIOX_TTS_SPEED*` or `VOICE_TTS_GAIN` from this note.  
**Date:** 2026-09-25  
**Job:** Steal setups from open-source voice stacks that already sound like people, then map only what fits SautiKit + Soniox + Gemini on a Kenya mobile.

Protocol we already score live DID with: [`../agents/VOICE_NATURALNESS.md`](../agents/VOICE_NATURALNESS.md). V5 matcher is in `looksLikePhaticCallerTurn`. This spec does not replace the freeze triad.

---

## Verdict

Roboticness on this platform is almost never "Soniox at 1.0 sounds like a robot." The stacks that win on GitHub treat **turn-taking** as the product: when the agent starts, when it stops, when it ignores "mm-hmm", when it resumes after a false barge, and when it speaks a whole sentence instead of a fragment.

Do not replace the Voice engine with LiveKit, Pipecat, Moshi, or CosyVoice. [`CONTEXT.md`](../../CONTEXT.md) already rejects those as product names. Steal their **turn table**, not their transport.

Do not chase a more "human" TTS model first. CosyVoice 3, Fish S2, Qwen3-TTS, Chatterbox Multilingual, and Smart Turn all skip Swahili. Soniox is the Kenya-capable path we already run.

---

## Six layers that make a voice agent sound like a person

Ranked by what live Kenyan DID calls actually punish. Each layer has an OSS source and a Scalers owner.

| # | Layer | Sounds robotic when | OSS that solved it | Scalers owner |
| --- | --- | --- | --- | --- |
| 1 | **End of caller turn** | Agent jumps in on "I can't seem to, um…" or waits a full second after "yes" | Pipecat Smart Turn v3.2; LiveKit `TurnDetector` | Voice `turnTaking.js` |
| 2 | **False barge / backchannel** | "Okay" or "mm-hmm" kills the reply, then a new "I'm listening" starts | LiveKit adaptive interruption + `resume_false_interruption` | Voice V9 + `SOFT_BACKCHANNELS` |
| 3 | **One utterance, not two** | `Sure.` is its own Soniox stream, then the sentence | LiveKit `min_consecutive_speech_delay`; sentence-only flush | Voice V1/V2 `spokenStreamBuffer` |
| 4 | **Dead air vs filler spam** | Silent 1.5s, or a filler on every turn | LiveKit `_FillerScheduler` (delay, interval, max_steps, cancel on speech) | Voice V7 filler cache |
| 5 | **What the mouth says** | Lists, playbook labels, `Al-vin`, `e.g.`, leaked `ASR_CORRECTION_PROMPT` | Rime prompt discipline; CosyVoice / Fish instruct tags | Voice lexicon + Brain F7 |
| 6 | **Timbre and emotion** | Flat read-aloud, no breath, no Kenyan EN/SW | Fish `[whisper]` / Chatterbox `[chuckle]`; Sesame CSM dialogue model | Soniox clone pick. **Do not swap TTS this cycle.** |

Slow is not robotic. `first_pcm_ms` stays on the A5 sheet. Speed stays 1.0.

---

## What Scalers already ships

Do not redo these before the next freeze.

| Already in repo | Why it exists |
| --- | --- |
| Sentence-only TTS flush (`VOICE_STREAM_EARLY_*` default 0) | V1. Mid-clause flush makes Soniox restart the thought. |
| Tiny lead-in merge (`Sure.` held until the next sentence) | V2 |
| Hyphen given-name collapse + punctuation polish | V3 / V4 |
| Phatic local reply skip (how-are-you) | V5. Still fails on bare `Okay.` |
| Idle nudge only after the caller has spoken | V6 |
| Filler as late safety net (400 ms `balanced`) | V7 |
| Caller-requested speed scale | V8 |
| Barge cancel + `SOFT_BACKCHANNELS` + wait/stop table | V9 |
| Cached greeting + filler PCM | Instant first audio, no dead air on answer |
| Do not send Soniox silence-reduction | Comment in `sonioxTts.js`: keeps pauses between words |
| Spoken replies capped at 25 words | Brain/Voice prompt rule |
| Naturalness scanner V1–V9 / B1–B3 | `src/speech/naturalnessScore.js` |

Live freeze still **fails V5** (`HD_d0f042f5d960`, `HD_391a57aae9e9`). Next Voice PR stays that matcher. Then V9 false-barge resume. Then semantic end-of-turn.

---

## Open-source stacks inspected

Stars and push dates from GitHub API on 2026-09-25. README plus (where noted) source or docs.

### Voice-agent frameworks (steal turn policy)

| Repo | Stars | Setup that matters | Kenya / Scalers fit |
| --- | --- | --- | --- |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | 15.8k | Modular STT/LLM/TTS. **Soniox is already a first-class STT and TTS plugin.** Smart Turn on VAD silence. Flows for structured jobs. | Steal Smart Turn + interruption table. Do not adopt Daily/WebRTC. |
| [livekit/agents](https://github.com/livekit/agents) | 14.4k | Default: Deepgram Nova-3 + Cartesia Sonic-3 + `inference.TurnDetector()`. `TurnHandlingOptions`: audio EOT, fixed/dynamic endpointing, adaptive interruption, `resume_false_interruption`, preemptive LLM (TTS optional). `_FillerScheduler`. `background_audio.py` (office, keyboard, thinking). Cached `session.say` PCM. | Best **policy catalog**. Apache-2.0. Do not move telephony onto LiveKit SIP. |
| [TEN-framework/ten-framework](https://github.com/TEN-framework/ten-framework) | 11.1k | Full conversational agent framework, Docker examples. | Overlap with LiveKit/Pipecat. No Kenya-specific win. |
| [fixie-ai/ultravox](https://github.com/fixie-ai/ultravox) | 4.6k | Speech-to-speech multimodal LLM. Last push 2025-12. | S2S would replace Gemini text turns. Brain contract change. Park. |
| [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) | 3.8k | Early STT-LLM-TTS. Last push 2024-11. | Superseded by Pipecat/LiveKit. Skip. |
| [soniox/soniox-pipecat-voicebot](https://github.com/soniox/soniox-pipecat-voicebot) | 1 | Official Soniox + Pipecat sample. Stale 2025-08. | Confirms Soniox is meant to sit in a Pipecat pipe. We already have the pipe. |
| [rimelabs/rime-livekit-agents](https://github.com/rimelabs/rime-livekit-agents) | small | LiveKit + Rime. Prompt-tuned "hyper-realistic" voices. Multilingual agent **swaps TTS voice when STT language flips**. | Steal language-sticky voice swap. We already have language sticky; confirm `soniox_voice_id` does not stay a US EN clone on SW turns. |

LiveKit recommended starting config (docs, 2026):

```
turn_detection = TurnDetector()          # audio EOT, not VAD-only
endpointing    = fixed, min 0.5s, max 3s
interruption   = adaptive, min 0.5s, resume_false_interruption=true
preemptive_generation.enabled = true
preemptive_tts = false                   # LLM early, TTS after confirm
```

Scalers today: Soniox endpoint + local adaptive flush (`INCOMPLETE_TAIL`, short confirms). No audio EOT model. No false-interruption resume of the same TTS stream. Prefetch TTS already exists; that is our preemptive_tts.

### Semantic turn detection (the highest-leverage steal)

| Repo | What it is | Numbers | Gap for us |
| --- | --- | --- | --- |
| [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn) v3.2 | Whisper-tiny + linear head. 16 kHz mono PCM. Run **only on VAD silence** over the last ~8s of the **current** turn. BSD-2. | 8M params. int8 CPU ~8 MB, 10–100 ms (Pipecat Cloud ~65 ms). 23 languages. | **No Swahili.** English-only first is still useful on Kenya EN turns. Fine-tune later. |
| [livekit/agents](https://github.com/livekit/agents) `inference.TurnDetector` | Unified **audio** end-of-turn. Replaces the old text-based English/Multilingual plugin (`livekit-plugins-turn-detector`, now deprecated). <500 MB RAM, CPU, shared server. | Default when you omit `turn_detection`. Endpointing defaults drop to 0.3 / 2.5 s when this model is on. | LiveKit Model License. Same Swahili unknown. Heavier than Smart Turn. |

Classic demo both repos use: "I can't seem to, um …" must **not** flush; "I can't seem to, um, find the return label." must flush. Our `INCOMPLETE_TAIL` regex is a cheap version of that. It misses tone and pace.

### Speech-to-speech (park)

| Repo | Setup | Why not now |
| --- | --- | --- |
| [kyutai-labs/moshi](https://github.com/kyutai-labs/moshi) 11.1k | Full duplex. Two audio streams (agent + user) + inner-monologue text tokens. Mimi codec 24 kHz → 12.5 Hz, 1.1 kbps, 80 ms frames. Theory 160 ms, practice ~200 ms on L4. PyTorch / MLX / Rust. CC-BY 4.0. | GPU. English synthetic voices (Moshiko/Moshika). Replaces Gemini + Soniox. No Kenya SW. |
| [SesameAILabs/csm](https://github.com/SesameAILabs/csm) 14.7k | Conversational Speech Model. Llama + Mimi RVQ. Built to generate **dialogue**, not read-aloud. Last push 2025-05. Needs CUDA + Llama-3.2-1B. | Same: not a Kenya DID TTS. Use as the **target quality** if we ever leave cascade. |

S2S keeps caller prosody (they sound rushed, agent matches). Cascade (us) throws that away at STT. That is a real "robot" cause. Fixing it means a new Brain+Voice architecture. Out of scope for this cycle.

### Expressive TTS (timbre layer only)

| Repo | Stars | Human trick | Kenya / phone fit |
| --- | --- | --- | --- |
| [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) S2 Pro | 32.8k | Sub-word tags: `[whisper]`, `[excited]`, `[angry]`. Dual-AR + RL. Claims 80 languages, 10M hours. | Research license. GPU. Do not put `[excited]` into Soniox text. |
| [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) | 26.6k | Turbo 350M, one-step decoder, sub-200 ms hosted. Native tags: `[cough]`, `[laugh]`, `[chuckle]`. Multilingual V3 = 23+ langs, better speaker similarity. | English Turbo is the agent model. SW unknown. GPU if self-host. |
| [index-tts/index-tts](https://github.com/index-tts/index-tts) | 24.2k | Controllable zero-shot. Strong EN/ZH eval. | No SW. |
| [QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice) 3.0 | 23.8k | Instruct: language, dialect, emotion, speed, volume. CMU phoneme inpainting. Bi-stream ~150 ms. | 9 langs, no SW. Phoneme inpainting is the idea we already do as lexicon respellings. |
| [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | 13.5k | Dual-track streaming, first packet after one character, claims 97 ms. NL instruction for tone/rate/emotion. | 10 langs, no SW. |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | 9.0k | 82M, used in local LiveKit examples. | Fast and thin. Not Kenyan. |
| [yl4579/StyleTTS2](https://github.com/yl4579/StyleTTS2) | 6.4k | Style diffusion, "human-level" MOS paper. Last push 2024-08. | Not streaming-first. Skip. |

**Soniox TTS as used here:** `model`, `language`, `voice`, `speed`, `pcm_s16le`, 16 kHz. No emotion, style, or SSML field in `beginSpeak`. We already refuse the silence-reduction flag so word pauses stay. Until Soniox ships instruct tags, layer 6 is **clone pick + lexicon**, not a new engine.

---

## Techniques that transfer (do these)

Copy the **behavior**. Keep SautiKit PCM and Soniox.

### T1. Audio end-of-turn on silence (Voice)

After Soniox/local VAD says silence, run a small classifier on the last few seconds of **caller** PCM (16 kHz, we already have it). Flush only if the model says complete.

Source: Smart Turn `predict_endpoint()` + their "um …" vs "um, find the label" fixture.

Fit: EN turns first. SW/Sheng stay on today's `INCOMPLETE_TAIL` + short-confirm table until we have SW labels. Do not run the model on every frame. Only on silence.

Success: freeze N2-style barge scripts stop cutting mid-clause; `voice-timing` flush reason logs `eot=model` vs `eot=regex`.

### T2. Resume the same TTS stream after a false barge (Voice, after V5)

LiveKit: `false_interruption_timeout` 2s + `resume_false_interruption=true`. If the barge was a backchannel or noise and no new transcript lands, **continue the paused PCM**, do not start "I'm listening."

We already classify `SOFT_BACKCHANNELS`. We cancel TTS. We do not resume.

Success: V9 pass on wait **and** no new stream after a lone "sawa" over a price line.

### T3. Filler scheduler, not filler-every-turn (Voice)

LiveKit `_FillerScheduler`: wait `delay`, speak one filler, optional `interval` + `max_steps`, reset dwell if user or agent speaks, `ctx.update()` resets after a tool takes the floor.

We have delay + cached PCM. We do not have max_steps or "tool took the floor, hold the filler."

Success: V7 stays pass. Action turns (`CREATE_REQUEST`) keep the existing progress line, not a second "Mm-hmm."

### T4. Thinking sound as PCM, not words (Voice, optional)

LiveKit `background_audio.py`: keyboard / office clips, equal-power fade, volume envelope. Used only while the agent is `thinking`.

On a Kenya mobile, office ambience sounds like a bad line. **Do not** mix city/office beds onto SautiKit.

Allowed steal: one short non-lexical clip (`mm`, breath) from the **same catalog voice**, already how `fillerPcmCache` works. Never a second Soniox utterance that says "I'm thinking."

### T5. Language-sticky TTS voice (Voice, confirm)

Rime multilingual agent: STT language flip → swap TTS voice in the same session.

We already sticky language for speed (`speedEn` / `speedSw`). Confirm the curated `soniox_voice_id` is a clone that can say SW, or pick a SW-capable sibling when `callLanguage=sw`. A US-EN clone speaking Kiswahili is a common "robot" report that is not V1–V9.

### T6. Keep sentence-only flush. Do not turn `VOICE_STREAM_EARLY_*` on (Voice)

LiveKit now defaults **preemptive TTS off**. They learned the same V1 lesson we did: speaking a speculative fragment, then restarting, sounds more robotic than 200 ms of wait.

Our prefetch-at-turn-start is the right half. Early word flush is the wrong half.

### T7. Brain wording still fails after Voice IDs pass (Brain)

If V1–V9 pass and the call still "sounds off," that is B1 lists, B2 name re-ask, B3 invented holding line. [`CALLER_EXPERIENCE_EXCELLENCE.md`](../agents/CALLER_EXPERIENCE_EXCELLENCE.md) F7. Hand Brain the SID. Do not raise gain.

---

## Techniques that do not transfer

| Idea | Why it dies here |
| --- | --- |
| Replace `/ws/media` with LiveKit SIP or Pipecat Daily | Lane invariant. `audio.drachtio.org` + Stream `connect=true`. |
| Swap Soniox for CosyVoice / Fish / Qwen3 / Chatterbox | No Swahili (or research license / GPU). Pronunciation lexicon would have to be rebuilt. |
| Moshi / Ultravox / Gemini Live as the receptionist | Replaces Gemini tools + transcript contract. No SW. GPU. |
| Room tone / office bed | Sounds like line noise on Safaricom/Airtel speakers. |
| Crank `SONIOX_TTS_SPEED` to "sound lively" | Already banned. Makes Kenyan money and names worse. |
| Put `[excited]` / `[chuckle]` in Gemini text for Soniox | Soniox will read the brackets. We already strip instruction leaks. |
| Smart Turn on every SW turn with the stock weights | 23-language list has no Swahili. Will mis-flush Sheng/SW. |
| Silence-reduction flag on Soniox | We already tried. 400 on some models. Kills natural pauses. |

---

## Ticket order (one Voice PR each)

Do not batch. Freeze SHA + three DID scripts after each.

| Order | Ticket | Voice ID | Steal from | Do not touch |
| --- | --- | --- | --- | --- |
| 0 | Ship V5: bare `Okay` / `ok` is not how-are-you | V5 | Live freeze | Speed, gain, EOT model |
| 1 | False-barge resume of the same stream | V9 | LiveKit `resume_false_interruption` | New TTS vendor |
| 2 | EN-only Smart Turn (or LiveKit audio EOT) on silence, SW stays regex | V1/V6 timing | `pipecat-ai/smart-turn` | Enable on `sw` until labeled |
| 3 | Filler max_steps + cancel when a progress line is already speaking | V7 | LiveKit `_FillerScheduler` | Thinking-ack copy |
| 4 | Confirm SW-capable clone on language flip | timbre | Rime language-swap | Catalog redesign |
| 5 | Speech-guarantee on ANSWER (`I can't finish that just now`) | later Voice | Live findings | Not a naturalness MOS |

Brain tickets stay Brain: F7 lists, name re-ask, invented holds.

---

## Live follow-up: five caller complaints (2026-09-25)

Owner agreed with the OSS verdict, then named five remaining sounds. Runtime for cache path and remaining leak prose landed in the Voice implementation PR. Do not enable `VOICE_STREAM_EARLY_*`. Do not retune `SONIOX_TTS_SPEED*` or `VOICE_TTS_GAIN`. V5 (bare `Okay` is not how-are-you) is already in `looksLikePhaticCallerTurn`.

| Caller said | What it is | Status |
| --- | --- | --- |
| Same speed from the first word. Human stress, not script-read. | Greeting clip vs live TTS | Shipped: cache stores raw PCM. `sendPcmToMedia` applies 1.38 on both. Greeting key includes profile speed. |
| Same exact speed on every call unless the caller asks | Per-call `ttsSpeedScale` starts at 1. V8 steps 0.15 | Shipped. Greeting key is now `voice\|lang\|speed\|text`. |
| Instruction leaks | Label stripper after `HD_ff24acf5207d` | Shipped labels plus `Speak this spelling once`, `VISIT COMMIT`, `the caller said`, `Alvin said`. `You said` / `I said` stay. Lists stay Brain. |
| Voice quality changes over time | Greeting / filler cache vs live reply | Shipped: no even-out on cache store. Language-flip clone is still ticket 4. |
| Word-by-word sounds robotic. Full sentence is good. Not `Al-vin` / comma dumps / `Alvin said` | Soniox treats each flush as a finished utterance | Sentence-only default. Narrator strip shipped. Tenant hyphen keep-list still Desk. |

### 1. Same speed from the first word (not script-read)

`ttsSpeedScale` is `1` at media-session start (`server.js`). Greeting capture only runs when scale is 1. Fillers skip the cache once the caller has changed pace.

That is not the start-of-call miss. The miss is **two loudness / contour paths**:

1. Cache miss (first call after boot, or new greeting text): `speakText` → Soniox at profile speed → `sendPcmToMedia` applies `VOICE_TTS_GAIN` (1.38) only.
2. Cache hit (before this PR): `putGreetingPcm` / `putFillerPcm` ran `evenOutPcmS16le` then `sendPcmToMedia` applied 1.38 again. Cache now stores raw PCM. Playback is gain only, same as live.

Human stress is a full-sentence contour. Script-read is a fragment restart: Soniox finishes the thought, then starts a new one. That is V1, not a speed-knob miss. Sentence-only flush is the fix. Early word flush is how it comes back.

Do not crank speed to sound lively. Freeze already scored V8 on N3.

### 2. Same exact speed across all calls unless asked

Already the contract:

- Every `/ws/media` session sets `ttsSpeedScale = 1`.
- `detectSpeedRequest` + `nextSpeedScale` (`src/speech/speedControl.js`) is the only writer.
- `speakText` / streamed `beginSpeak` pass `speedScale: ttsSpeedScale`.
- Cached fillers are skipped when `ttsSpeedScale !== 1` so a slower ask is not answered with a 1.0 clip.

Cross-call sameness is the process-level greeting cache. Same `voice|lang|text` clip for every caller. That is what we want **if** the clip was rendered at today's profile speed.

`greetingPcmKey` is now `voice|lang|speed|text` via `speedForLanguage`, same idea as fillers. `ttsSpeedScale !== 1` still bypasses the filler cache. Do not persist `ttsSpeedScale` across calls.

### 3. Instruction leaks

Shipped stripper: `src/speech/spokenInstructionLeak.js`, wired in `spokenStreamBuffer`, `prepareForTts`, and Gemini history clone. Tests cover the `HD_ff24acf5207d` block.

Stripper now also drops `Speak this spelling once`, `VISIT COMMIT`, `think this; never say it as a script`, `the caller said` / `the user said`, and sentence `Name said` narration. `You said` / `I said` stay. Lists / F7 stay Brain.

Brain should still stop injecting speakable orders. Voice strips them if they leak.

Do not put `[do not say this]` tags in Gemini text. Soniox will read the brackets. The existing stripper exists because that already happened.

### 4. Voice quality changes from time to time

Not a random Soniox clone swap on every turn. Same `tenants.soniox_voice_id` for the call.

What the caller hears as "the voice changed":

1. **Even-out only on cache store.** Fixed: greeting and filler caches store raw PCM. Both paths get 1.38 on send.
2. **Greeting vs reply in one call.** Same send path after the cache fix.
3. **Fragment vs sentence** if anyone sets `VOICE_STREAM_EARLY_CHARS` / `WORDS` above 0. Default is 0. Leave it.
4. **Language flip.** EN clone spoken as SW (or the reverse) if `soniox_voice_id` stays a US EN voice. Ticket 4 in the OSS table. Not a gain retune.

`VOICE_SPEED_CONSISTENCY.md` Phase 1 example is now `VOICE_TTS_GAIN=1.38` to match freeze / `voiceProfile.js` `balanced`. That is a doc align, not a retune.

### 5. Word-by-word is robotic. Full sentence is good. Not `Al-vin,,,,said`

Live finding (`LIVE_CALL_FINDINGS.md`, 2026-09-10): flushing 5-word / comma fragments made Soniox sound out then restart. That is the Alvin-comma-said quality: hyphen name, comma dump, then a narrator verb.

Already the default:

- `splitSpeakableChunks`: sentence-only unless `VOICE_STREAM_EARLY_CHARS` > 0.
- Tiny lead-in (`Sure.` / `I'm listening.`) held until the next sentence (V2).
- `sanitizeSayForm`: `Al-vin` / `Jo-hn` → `Alvin` / `John`. Keeps `Air-tel` / `Kris-to-fa`.
- `polishPunctuation`: `!` → `.`, `,,` collapse, em/en dash → comma, numbered `1.` → `1,`.

Do **not** enable early flush to chase `first_pcm_ms`. [`VOICE_SPEED_CONSISTENCY.md`](../agents/VOICE_SPEED_CONSISTENCY.md) Phase 1 "Earlier stream flush" and principle "First audio beats perfect sentence" are **superseded**. Sentence-only wins. Pipecat aggregates to a sentence for the same reason.

Remaining:

- Tenant lexicon `alvin` → `Al-vin` was the `HD_3f7ed2a5f526` extra word. Sanitizer should collapse it on parse. If a Desk say-form still has a hyphen the keep-list does not cover, it will speak as two words.
- `Alvin said` narrator is stripped before TTS. Comma dumps stay a fragment-flush miss if anyone enables early flush.

Cache path, greeting speed key, and remaining leak prose shipped in the Voice implementation PR. `VOICE_STREAM_EARLY_*` stays 0. Next freeze score is still the V1–V9 triad on staging DID. Language-flip clone remains the later timbre ticket.

---

## How to score a steal

Same triad as [`VOICE_NATURALNESS.md`](../agents/VOICE_NATURALNESS.md): recording or phone speaker, desk transcript, `spoken=` + `[voice-timing]`. Isolated `tts:listen-harness` does not prove turn-taking.

Add one log field when T1 lands: `eot=regex|model|stt` on the flush line. Without that, we cannot tell if Smart Turn helped.

---

## Sources

Opened or API-fetched 2026-09-25:

- https://github.com/livekit/agents (README, `filler_scheduler.py`, `background_audio.py`, `livekit-plugins-turn-detector/README.md`)
- https://docs.livekit.io/reference/agents/turn-handling-options/
- https://docs.livekit.io/agents/multimodality/audio/
- https://docs.livekit.io/agents/logic/turns/tuning/
- https://github.com/pipecat-ai/pipecat
- https://github.com/pipecat-ai/smart-turn
- https://github.com/kyutai-labs/moshi
- https://github.com/SesameAILabs/csm
- https://github.com/fishaudio/fish-speech
- https://github.com/resemble-ai/chatterbox
- https://github.com/QwenAudio/CosyVoice
- https://github.com/QwenLM/Qwen3-TTS
- https://github.com/TEN-framework/ten-framework
- https://github.com/fixie-ai/ultravox
- https://github.com/rimelabs/rime-livekit-agents
- In-repo: `VOICE.md`, `VOICE_NATURALNESS.md`, `VOICE_SPEED_CONSISTENCY.md`, `LIVE_CALL_FINDINGS.md`, `src/speech/sonioxTts.js`, `spokenStreamBuffer.js`, `spokenInstructionLeak.js`, `greetingPcmCache.js`, `fillerPcmCache.js`, `pcmUtil.js`, `speedControl.js`, `turnTaking.js`, `voiceProfile.js`, `src/conversation/brainState.js`

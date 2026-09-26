# Wayfinder: returning-caller card

## Destination

Live calls load a compact phone file as a candidate. This call binds the speaker before using last reason or a visit. Unique and shared lines both ask who is speaking until that bind. Evals score the card. Instant greeting stays brand-first.

## Notes

Lanes: Brain + Platform read helper. Spec: `docs/specs/caller-memory.md`. ADR-0005. Skills: tdd, code-review. Do not dump transcripts. Do not migrate the live Gemini loop to the Vercel AI SDK.

## Decisions so far

- Phone file not transcript replay (this PR)
- Card may mark greet-by-name on unique lines; runtime does not seed `nameConfirmed` from that flag
- Instant TTS opener unchanged (this PR)
- Evalite scores card shape without wrapping `@google/genai` (this PR)
- Bind-before-use on unique and shared lines (this PR)
- Bound lived file is labeled Open / Last / History / Place rows the model can cite (this PR)

## Not yet specified

- Optional LLM-as-judge evals when `GEMINI_API_KEY` is present (spoken ≤25 words, no invented price)
- Whether a later Voice ticket may add a short "welcome back, Jane" to the local opener without adding Gemini wait. Do not add it until this call has bound the speaker.

## Out of scope

- Mid-call RAG
- Fine-tuning Gemini
- Twenty as the live file
- Desk `/contacts` changes
- Hangup review rewriting `last_reason` onto the phone file

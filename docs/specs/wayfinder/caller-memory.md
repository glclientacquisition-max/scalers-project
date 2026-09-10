# Wayfinder: returning-caller card

## Destination

Live calls load a compact phone file. Unique named lines seed Brain state. Shared lines confirm identity. Evals score the card. Instant greeting stays brand-first.

## Notes

Lanes: Brain + Platform read helper. Spec: `docs/specs/caller-memory.md`. ADR-0005. Skills: tdd, code-review. Do not dump transcripts. Do not migrate the live Gemini loop to the Vercel AI SDK.

## Decisions so far

- Phone file not transcript replay (this PR)
- Greet-by-name only on unique lines (this PR)
- Instant TTS opener unchanged (this PR)
- Evalite scores card shape without wrapping `@google/genai` (this PR)

## Not yet specified

- Optional LLM-as-judge evals when `GEMINI_API_KEY` is present (spoken ≤25 words, no invented price)
- Whether a later Voice ticket may add a short "welcome back, Jane" to the local opener without adding Gemini wait

## Out of scope

- Mid-call RAG
- Fine-tuning Gemini
- Twenty as the live file
- Desk `/contacts` changes

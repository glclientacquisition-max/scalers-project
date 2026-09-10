# Spec: returning-caller card

**Status:** Accepted for this PR  
**Lanes:** Brain (prompt + Brain state) + Platform (`getCallerMemory` read)  
**ADR:** [ADR-0005](../adr/ADR-0005-returning-caller-card.md)

## Destination

The next call from a known tenant phone does not start empty. Brain receives a compact **returning-caller card** at call setup and may use the file name on a unique line.

## Decisions

1. **Key:** tenant + stored phone (Kenya E.164 when possible). No embeddings. No transcript replay.
2. **Card fields:** name, shared-line flag, last reason, up to two open service requests, one next appointment (requested or confirmed). Clip each string. Drop transcript-like notes.
3. **Greet by name** only when a primary name exists and `alternate_names` is empty. Shared line: confirm who is speaking; do not assume the primary name.
4. **Instant TTS greeting stays brand-first.** Do not wait on Gemini or lengthen the opener with history. The card is for the first Gemini turn via CONTEXT HEADER + seeded Brain state.
5. **Seed Brain state** on a unique named line: `caller.name` + `nameConfirmed=true` so the model does not re-ask "Got it, Jane?" On a shared line, leave name empty.
6. **Write path unchanged:** `upsertContact` on requests/appointments and `persistCompletedCallContact` after hangup already persist the file. This spec is the read path.
7. **Unknown number:** no card, current cold open.
8. **Out of scope:** mid-call RAG, fine-tuning Gemini, Twenty/CRM import into the prompt, dumping prior `transcripts` rows, Desk UI changes.

## Observable behavior

- `buildSystemPrompt` includes a `RETURNING CALLER` block when a card is present, and omits it when absent.
- That block never contains `Caller:` / `Agent:` transcript lines.
- `createBrainState({ callerMemory })` seeds name only when `greetByName` is true.
- `getCallerMemory` returns null when the contacts table is missing or no row matches.

## Tests

- `tests/callerMemory.test.js` (lane gate `npm run test:brain`)
- `evals/caller-memory.eval.ts` (`npm run eval:brain`)

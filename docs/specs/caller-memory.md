# Spec: returning-caller card

**Status:** Accepted for this PR  
**Lanes:** Brain (prompt + Brain state) + Platform (`getCallerMemory` read)  
**ADR:** [ADR-0005](../adr/ADR-0005-returning-caller-card.md)

## Destination

The next call from a known tenant phone does not start empty. Brain receives a compact **returning-caller card** at call setup. That card is a **candidate keyed by phone**, not proof of who is speaking. Instant TTS stays brand-first. After this call confirms a spoken name, bind the card to that speaker so CONTEXT HEADER and CALL STATE may use last reason and the open visit.

## Live-call workflow

1. Ring. Voice loads the tenant profile. Instant greeting is brand-first (`{Shop}, this is {Name}. How can I help?`). No Gemini. No file name.
2. `hydrateCallerMemory` → `getCallerMemory({ tenantId, from_number })`. Compact card on `profile.callerMemory`. Gemini `contents` and `callBrainStates` are per `callSid`. A different number is a fresh Brain. The same number is the same **phone** file.
3. `createBrainState` copies the phone only. It does not set `caller.name` or `nameConfirmed`.
4. First reasoned turn. `RETURNING CALLER` names the file as a candidate. CALL STATE: speaker not bound. NBA on hello / how-are-you: ask who is speaking. Phatic: `I'm well. Who is calling?` Last reason, open visit, and recent bookings stay hidden. OPEN VISITS omits this phone's rows so the previous job cannot look like occupancy for whoever is on the line.
5. Caller says a name. `applyCallerNameConfirmation` + `bindCallerMemoryCard`. Primary (file owner or unique unnamed line): unlock last reason / visit / recent bookings. Alternate or a different name: identity only. Then do not re-ask.
6. Hangup still upserts `contacts` by phone (`persistCompletedCallContact`). That write can still poison the next call's candidate file. It must not bind the next speaker.

## Decisions

1. **Key:** tenant + stored phone (Kenya E.164 when possible). No embeddings. No transcript replay.
2. **Card fields:** name, shared-line flag, last reason, up to two open service requests, one next appointment (requested or confirmed), up to two recent bookings (done or earlier visits, not the next open one). Clip each string. Drop transcript-like notes.
3. **Greet by name** on the card means a unique primary name exists (`alternate_names` empty). It does **not** confirm the speaker. Instant TTS never greets by that name.
4. **Instant TTS greeting stays brand-first.** Do not wait on Gemini or lengthen the opener with history. The card is for the first Gemini turn via CONTEXT HEADER + Brain state.
5. **Do not seed Brain name.** Unique and shared lines leave `caller.name` empty until this call confirms a spoken name.
6. **Write path unchanged:** `upsertContact` on requests/appointments and `persistCompletedCallContact` after hangup already persist the file. This spec is the read path.
7. **Unknown number:** no card, current cold open. Clear `profile.callerMemory` when lookup returns null so a prior call cannot leak.
8. **Live bind:** when `caller.nameConfirmed` is true, match the spoken name to the loaded phone card (primary vs `alternate_names`). Primary (or unique unnamed line) may use last reason / open visit. Alternate or a different name on a unique line gets identity only. Rebuild CONTEXT HEADER for that speaker. No new DB lookup. No name search.
9. **Out of scope:** mid-call RAG, fine-tuning Gemini, Twenty/CRM import into the prompt, dumping prior `transcripts` rows, Desk UI changes, lookup by name across phones, hangup review rewriting `last_reason` (Platform).

## Observable behavior

- `buildSystemPrompt` includes a `RETURNING CALLER` block when a card is present, and omits it when absent.
- That block never contains `Caller:` / `Agent:` transcript lines.
- Unique unbound: identity is `phone file for {name}; speaker not bound`. Last reason and visit are omitted until bind.
- `createBrainState({ callerMemory })` copies phone only. It does not set `nameConfirmed`.
- `getCallerMemory` returns null when the contacts table is missing or no row matches. `attachCallerMemory` then deletes any stale card on the profile.
- After a confirmed name, `bindCallerMemoryCard` / `observeCallerTurn` attach the household visit only when the speaker matches the primary file name.
- Up to two recent bookings appear in `RETURNING CALLER` / CALL STATE when the speaker owns the file. They are not read aloud as a list.

## Tests

- `tests/callerMemory.test.js` (lane gate `npm run test:brain`)
- `evals/caller-memory.eval.ts` (`npm run eval:brain`)

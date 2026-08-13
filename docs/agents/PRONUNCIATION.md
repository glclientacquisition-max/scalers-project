# Pronunciation system (Scalers)

**Mission:** Make Kenyan receptionist names, places, and brands sound right on Soniox phone TTS — without letting owners accidentally poison common English.

## How it works (call path)

1. Desk saves curated overrides to `tenants.tts_lexicon` → `[{ match, say, priority }]`.
2. Voice loads them in `getTenantProfile` → `ttsLexiconOverrides`.
3. Every TTS utterance runs `prepareForTts()` → `applyLexicon()` (tenant overrides win over global Kenya lexicon).

**Keep in Train saves immediately.** Save & train is for prompt compile, not required for lexicon Keep/Remove.

## Failure mode we hit (2026-08-11)

Open-ended “learn every word from my recording” produced entries like:

| match | say | Effect |
| --- | --- | --- |
| `where` | `Ware` | Every “where” mangled |
| `city` | `Si-ti` | Address lines destroyed |
| `located` | `loh-kay-tid` | Same |

**Rule:** Never train blocked common-word matches. Voice + desk `parse*` drop them.

## Best product shape (Pronunciation studio)

| Pack | Line (example) | Targets only |
| --- | --- | --- |
| Greeting | “Hello, you've reached ChapterOne Bookstore, this is Aisha speaking.” | business, agent |
| Location | “We're on Muindi Mbingu Street, opposite City Market Fashion Mall.” | hard place names |
| Team | “I can have Harrison Maina follow up with you.” | team names |

## Owner workflow (best path)

**Goal:** hard names sound right on the live DID — with as few clicks as possible.

| Step | Where | What |
| --- | --- | --- |
| 1 | **Practice** | Run Greeting / Location / Team packs. **Use this take** saves to live lexicon. |
| 2 | **Fix → Needs review** | Clear AI drafts first. Primary: **Record**. Secondary: **Approve spelling**. Reject/Snooze under More. |
| 3 | **Fix → Add a fix** | Type the bad name → **Record & train**. Typed spelling is a fallback (“Or save a spelling…”). |
| 4 | **Fix → Find more** | **Quick scan** = transcripts → Practice. **AI listen** = Gemini on recordings → Needs review (never auto-applies). |
| 5 | **Test** | **Play phone preview** (same Soniox path as calls), then tap the live DID. |

**Do not** train common English (`where`, `city`, …). **Do** prefer real audio over AI phonetic guesses.

### Tabs (unchanged product shape)

1. **Library** — every live `say`; Renew / Edit say / Remove.
2. **Practice** — packs + mined / renew / record-from-review items.
3. **Fix** — Needs review → Add a fix → Find more (Quick scan + AI listen).

## Gemini Scan review gate (do not “helpfully” remove)

Gemini Scan is a **drafting** tool, not an auto-trainer:

- Suggestions land in `tenants.pronunciation_review_queue` with `source: "gemini_scan"` and `status: "pending"`.
- They **must not** write `tts_lexicon` until a human Approve sets `approved_by` + `approved_at` (enforced in `assertApprovedForLexiconWrite` / `candidateToLexiconEntry`).
- There is **no** auto-approve / high-confidence bypass — not even behind an env flag.
- Reject / Snooze records a dismissal key so the same call+word does not resurface.
- `LIKELY_MISHEARD` is an STT hint — never a TTS lexicon write.
- Heuristic **Scan recent calls** remains a separate candidate source feeding Practice.

Apply `docs/supabase/pronunciation_gemini_scan.sql` for the queue / dismissal / log columns.

## Guardrails

- Common English single-word matches are blocked (`where`, `city`, `located`, …).
- Keep / Edit say / Remove / typed Save update `tts_lexicon` immediately for the **next call**.
- Recording **Use this take** verifies via Gemini multimodal (requires `GEMINI_API_KEY` on Vercel).
- Browser MIME is normalized (`audio/webm;codecs=opus` → `audio/webm`) before Gemini.
- If Gemini is down/misconfigured, we still save **only the known pack targets** with a local say-as (never open-ended inventing).
- Gemini Scan failures show a clear error and leave the Fix tab usable; partial bad model rows are dropped, not applied.

## Do / don’t for `say` forms

- Do: light respellings (`Eye-sha`, `Moo-in-dee Mbeen-goo`, `Chapter One`).
- Don’t: hyphenate every English syllable (`Si-ti`, `Op-po-sit`, `loh-kay-tid`).
- Don’t: single common words as `match`.

## Verify

```bash
node scripts/smoke-pronunciation-chapterone.js
npm run test:tts
cd dashboard && npx tsx --tsconfig tsconfig.json --test \
  ../tests/pronunciationStudio.test.ts \
  ../tests/pronunciationGeminiScan.test.ts \
  ../tests/pronunciationFlow.test.ts
node --test tests/pronunciationPacks.test.js tests/pronunciationCoach.test.js tests/pronunciationVerify.test.js
node --test tests/voicePublicBase.test.js tests/wavPack.test.js tests/sonioxVoice.test.js
cd dashboard && npm run build
```

Call the DID and listen for greeting + address without mangled common words.

## Ownership

- Desk coach UI / packs / sanitize-on-save → Desk + light Platform
- `prepareForTts` / global Kenya lexicon → Voice
- Column grants `tts_lexicon` → Platform (`docs/supabase/tts_lexicon.sql`)

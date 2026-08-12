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

## Owner workflow (studio)

1. **Trained pronunciations** — see every live `say` form; **Renew** (re-record), **Edit say** (typed tweak), or **Remove**. Labels are stored with the lexicon so Renew always re-trains the real name (never the phonetic spelling).
2. **Heard something wrong?** — type the word/sentence → **Queue to record** (best) or **Save typed spelling** (requires a say-like form).
3. **From recent calls** — **Scan recent calls** mines hard names from agent transcripts (Title Case + profile name hints for lowercase ASR) into the queue.
4. **Training queue** — Greeting / Location / Team packs plus custom / mined / renew items.

## Guardrails

- Common English single-word matches are blocked (`where`, `city`, `located`, …).
- Keep / Edit say / Remove / typed Save update `tts_lexicon` immediately for the **next call**.
- Recording **Use this take** verifies via Gemini multimodal (requires `GEMINI_API_KEY` on Vercel).
- Browser MIME is normalized (`audio/webm;codecs=opus` → `audio/webm`) before Gemini.
- If Gemini is down/misconfigured, we still save **only the known pack targets** with a local say-as (never open-ended inventing).

## Do / don’t for `say` forms

- Do: light respellings (`Eye-sha`, `Moo-in-dee Mbeen-goo`, `Chapter One`).
- Don’t: hyphenate every English syllable (`Si-ti`, `Op-po-sit`, `loh-kay-tid`).
- Don’t: single common words as `match`.

## Verify

```bash
node scripts/smoke-pronunciation-chapterone.js
npm run test:tts
cd dashboard && npx tsx --tsconfig tsconfig.json --test ../tests/pronunciationStudio.test.ts
node --test tests/pronunciationPacks.test.js tests/pronunciationCoach.test.js
```

Call the DID and listen for greeting + address without mangled common words.

## Ownership

- Desk coach UI / packs / sanitize-on-save → Desk + light Platform
- `prepareForTts` / global Kenya lexicon → Voice
- Column grants `tts_lexicon` → Platform (`docs/supabase/tts_lexicon.sql`)

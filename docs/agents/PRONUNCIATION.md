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

**No repeats:** at most one of each pack; each hard name claimed once; duplicate prompts dropped.

**Logical sense:** every prompt must contain its target labels; skip filler fragments (“Shop No”); no “just to confirm…” spam.

## Do / don’t for `say` forms

- Do: light respellings (`Eye-sha`, `Moo-in-dee Mbeen-goo`, `Chapter One`).
- Don’t: hyphenate every English syllable (`Si-ti`, `Op-po-sit`, `loh-kay-tid`).
- Don’t: single common words as `match`.

## Verify

```bash
node scripts/smoke-pronunciation-chapterone.js
npm run test:tts
```

Call the DID and listen for greeting + address without mangled common words.

## Ownership

- Desk coach UI / packs / sanitize-on-save → Desk + light Platform
- `prepareForTts` / global Kenya lexicon → Voice
- Column grants `tts_lexicon` → Platform (`docs/supabase/tts_lexicon.sql`)

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
| 2 | **Fix → Needs review** | Hear the proposed say, then **Use this** writes that one fix. Record and Spelling stay ghost and do not write alone. Hearing rows use muted Dismiss. |
| 3 | **Fix → Add a fix** | Type the bad name → **Record & train**. Typed spelling is a fallback (“Or save a spelling…”). |
| 4 | **Fix → Find more** | **AI listen** (filled) is the only control on that row. It opens on Last 10 and starts immediately. Last 20 and Last 50 confirm with "Listen to the last N recordings." **Scan** is a muted text control under the review list and reads transcripts into Practice. Nothing from a listen writes `tts_lexicon`. |
| 5 | **Test** | **Play phone preview** (same Soniox path as calls), then tap the live DID. |

**Do not** train common English (`where`, `city`, …). **Do** prefer real audio over AI phonetic guesses for unfamiliar words.

### Tabs (unchanged product shape)

1. **Library** — every live `say`; Renew / Edit say / Remove.
2. **Practice** — packs + mined / renew / record-from-review items.
3. **Fix.** Needs review, then Add a fix, then Find more (AI listen). Scan sits under the review list.

## Gemini Scan apply policy

Lexicon writes still require `approved_by` + `approved_at` (enforced in `assertApprovedForLexiconWrite`).

| Path | What happens |
| --- | --- |
| **Listen** | Every candidate, including high-confidence profile names and places, lands on Needs review. The line next to AI listen counts new rows from that tap ("3 new." or "Nothing new."). The same name from several calls is one row. A failed save keeps those rows on screen. **Save review** writes them without listening again. |
| **Use this** | The only control that writes that fix to `tts_lexicon`. Owner stamp (`approved_by` + `approved_at`) is still required. |
| **Record / Spelling** | Ghost. They do not write the AI guess by themselves. |
| **Never from a listen** | Blocked commons, `LIKELY_MISHEARD`, and any row the owner has not confirmed with Use this. |

- Reject / Snooze records a dismissal key so the same call+word does not resurface.
- Heuristic **Scan recent calls** remains a separate candidate source feeding Practice. It is a muted text control under the review list, not on the Find more row.
- AI listen walks recent calls until it has that many recordings. The walk stops at 4 times the count or 200 calls, whichever is smaller. None found: "No recordings to listen to."
- The waiting list holds at most 80 names. Names from the listen that just finished stay, then older rows, newest first.

Apply `docs/supabase/pronunciation_gemini_scan.sql` for the queue / dismissal / log columns and the `authenticated` UPDATE grant. Without that grant, a confirmed listen fails with "Could not save the listen." An empty Needs review line stays "Nothing waiting." The Fix tab reads `pronunciation_review_queue` on its own. The settings tenant select does not include it.

## Guardrails

- Common English single-word matches are blocked (`where`, `city`, `located`, …).
- Keep / Edit say / Remove / typed Save update `tts_lexicon` immediately for the **next call**.
- Recording **Use this take** verifies via Gemini multimodal (requires `GEMINI_API_KEY` on Vercel).
- Browser MIME is normalized (`audio/webm;codecs=opus` → `audio/webm`) before Gemini.
- If Gemini is down/misconfigured, we still save **only the known pack targets** with a local say-as (never open-ended inventing).
- Listen failures the owner sees are "Could not listen.", "No recordings to listen to.", "Could not save the listen.", "Could not load review.", or "Could not save the review." A missing setup says "Listen is unavailable." A rate limit says "Wait a few minutes." Those lines do not name a provider, an API key, or a charge. Partial bad model rows are dropped, not applied.

## Do / don’t for `say` forms

- Do: light respellings (`Eye-sha`, `Chapter One`).
- Places: speak the name as written. A built-in place respelling lives in `PLACE_LEXICON` (`src/speech/pronunciationLexicon.js`) only with a `verified` note (date, voice id, TTS settings, STT result, source); `tests/pronunciationLexiconEvidence.test.js` fails without one. On 2026-10-08 (#612) a plain vs respelled render through the real voice heard `Kee-ahm-boo` as "Kigambo", `Joo-jah` as "Georgia" and `Roo-ee-roo` as "Rui Rou", while the plain names came back right. Only `West-lands` (plain heard as "wastelands") is kept.
- Don’t: hyphenate every English syllable (`Si-ti`, `Op-po-sit`, `loh-kay-tid`).
- Don’t: single common words as `match`.
- Don’t: ALLCAPS stress in `say` (`KIP-rop`). Soniox may spell the letters. Keep stress in `stressSyllable` metadata on generated candidates only.

Generated candidates live in `src/speech/generatedKenyaLexicon.json`. `scripts/generate-kenya-lexicon.js` does not write `KENYA_LEXICON` unless `--promote`. Listen first:

```bash
node scripts/soniox-tts-listen-harness.js --fixture tests/fixtures/kenya-phonetic-listen.json --mode production
```

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

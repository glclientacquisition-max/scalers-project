# TTS normalization listen harness

Diagnose-first tooling for the **shared** `prepareForTts()` pipeline (`src/speech/ttsNormalize.js` → `src/speech/spokenForms.js`). Every tenant uses this path before Soniox.

## What this is

| Artifact | Purpose |
| --- | --- |
| `tests/fixtures/tts-normalization.json` | 20 strings: 18 **universal** patterns + 2 **lexicon_control** tenant examples |
| `scripts/soniox-tts-listen-harness.js` | Synthesizes **raw** vs **production** WAVs + scoring sheet |
| `tests/ttsNormalizationFixture.test.js` | Repeatable text regression (no Soniox required) |

## Quick start

```bash
# Text regression (CI-safe)
npm run test:tts-fixture

# Listen harness (text manifest always; WAVs when Soniox env is set)
npm run tts:listen-harness
```

Set `SONIOX_API_KEY` and `SONIOX_VOICE` (same as production voice) to generate audio under `output/tts-normalization/`.

## Listen workflow

1. Run `npm run tts:listen-harness`
2. Open `output/tts-normalization/scoring-sheet.md` on your phone or print it
3. Play each `{id}_raw.wav` and `{id}_production.wav` on a **phone speaker**
4. Fill **pass_a** (raw) and **pass_b** (production): Pass / Soft fail / Hard fail
5. **Only fix Pass B failures** in `spokenForms.js` (patterns) or Pronunciation Library (fixed tokens)
6. Re-run `npm run test:tts-fixture` and `npm run tts:listen-harness` after any code change

### Decision rule

| Pass A | Pass B | Action |
| --- | --- | --- |
| Fail | Pass | Leave code alone — pipeline already fixes it |
| Fail | Fail (pattern) | Narrow fix in `spokenForms.js` |
| Fail | Fail (fixed token) | Library/lexicon entry, not code |
| Pass | Pass | Done |

## Fixture groups

### Universal (cases 01–18)

Reused for every tenant. Examples are realistic Kenyan formats (prices, spaced mobiles, hours) but **not** tied to one business name.

### Lexicon control (cases 19–20)

Tenant-specific **examples** (ChapterOne / Aisha / Manga) to confirm lexicon and normalizer do not fight. When onboarding a new tenant, swap only these two lines — universal cases stay fixed.

## Date priority (live transcript grep)

Queried all agent `transcripts` (748 lines, all tenants):

| Pattern | Count in agent speech |
| --- | --- |
| Calendar dates (`12th August`, `12/08/2026`) | **0** |
| Slash dates | **0** |
| Weekday / relative (`tomorrow`, `Thursday`) | Common |
| Clock times (`9:00 AM`, `7:00 PM`) | Common |
| Money (`KSH 1000`, `1000 shillings`) | Common |
| Spaced phones (`0740 442 943`) | Seen |
| URLs (`.co.ke`) | Seen |

Date cases **remain in the fixture** for regression, but are **deprioritized** for listen fixes until real calls start quoting calendar dates.

## Harness options

```bash
node scripts/soniox-tts-listen-harness.js --mode raw
node scripts/soniox-tts-listen-harness.js --mode production
node scripts/soniox-tts-listen-harness.js --id 05-phone-spaced-local
node scripts/soniox-tts-listen-harness.js --output /tmp/tts-listen
```

## Outputs

```
output/tts-normalization/
  manifest.json          # raw vs production text sent to Soniox
  scoring-sheet.md       # human listen form (scores blank)
  scoring-sheet.csv      # same, for spreadsheets
  01-price-bundle_raw.wav
  01-price-bundle_production.wav
  …
```

`output/` is gitignored — commit fixture + script changes, not generated WAVs.

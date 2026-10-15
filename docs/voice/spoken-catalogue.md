# Spoken catalogue + v2 catalogue step (VOICE_V2_CATALOGUE, off by default)

Migration step 3 of `research/proven-voice-pipeline.md`: catalogue/discovery moves from
filters (service_dump, catalogue mouth, mouth lock) to a v2 state step. Patterns copied, not invented:

- **Rasa CALM**: the model emits one checked command `{intent, service_id?, category_id?, language}`
  (JSON mode + schema; enums built from the tenant's own catalogue). Invalid, slow (>700 ms) or
  missing → the deterministic rules command. The model never writes the reply.
- **Pipecat Flows**: per-step templates with `{{slot}}` placeholders; a missing slot is an error and
  the step yields to legacy instead of speaking a hole.
- **Facts only from data**: every service word, category and price comes from the spoken catalogue.
- **lang slot**: call language, moved only by v2's sticky language rule on a clear caller turn.
- **Filters to log-only**: when v2 owns the turn, catalogue mouth / service dump / hedge strip run in
  shadow over the v2 line and log `v2_catalogue shadow ... would have ...`. Removal comes after shadow data.

## Spoken catalogue (tenant data)

`src/knowledge/spokenCatalogue.js`, one doc per tenant:

| field | content |
|---|---|
| `entries[].spoken.{en,sw}` | names a receptionist says ("usafi wa nyumba ya vyumba viwili") |
| `entries[].category.{en,sw}` / `categories[]` | plain categories used for the first answer |
| `entries[].explain.{en,sw}` | one sentence per service |
| `entries[].price.{en,sw,numbers}` | price as spoken; numbers parsed from the raw catalogue only |
| `coverage.places[]` | area key, canonical full name, aliases, counties |
| `coverage.ambiguityGroups[]` | e.g. `rongai` → Rongai / Ongata Rongai (two counties) → future clarify step |
| `sourceHash`, `version`, `rowHash` | regeneration keys |
| `status` (`draft`/`approved`), `edited`, `issues[]` | owner review (Desk UI later) |

Build = deterministic baseline (always) + optional AI pass. The AI output is checked field by field
(length, no digits, no claim words, no raw English name in sw, sentence form, known ids only); a failed
field keeps the baseline and lands in `issues[]` for the owner. Same code for every tenant; no tenant ids.

## Onboarding / regeneration flow

1. Owner saves catalogue / areas (onboarding or Train) → Brain's knowledge compile calls
   `compileSpokenCatalogue(profile, { generate, previous })` (Brain lane; hook requested).
2. Result is written as a new row in `tenant_spoken_catalogue_versions` (status draft) and to
   `tenants.spoken_catalogue` (migration `supabase/migrations/20261015063255_spoken_catalogue.sql`, applied on staging).
3. Live call: `resolveSpokenCatalogue(profile)` uses the stored doc when its `sourceHash` matches the
   current catalogue, else compiles the rules baseline in-process (memoised by hash). So a tenant is
   never without a spoken catalogue, including before backfill.
4. Catalogue edit → hash changes → recompile; rows whose `rowHash` is unchanged keep owner edits/approval.
5. Owner reviews/edits in Desk (later) → `applyOwnerEdit` / `approve`.

Backfill: `node scripts/backfill-spoken-catalogue.js [--tenant id] [--ai]` (dry run; `--apply` writes,
only after the migration exists).

## Cost per tenant (estimates)

- Compile: one model call per catalogue change, ~2k input + ~1-1.5k output tokens for a 16-row
  catalogue → well under US$0.01 per compile on a Flash-class model. Rules baseline: zero.
- Runtime: one flash-lite JSON command call only on catalogue turns (~1k in / ~20 out tokens),
  700 ms cap, rules fallback. `VOICE_V2_CATALOGUE_MODEL=off` → rules only, zero cost.
- Storage: ~10-30 KB JSON per version.

## Gates

`npm run test:v2-catalogue` (unit + sense-check replay over every HD fixture);
`VOICE_V2_CATALOGUE=1 node scripts/replay-voice-suite.js` (no score drop);
`node scripts/v2-catalogue-sense.js` (prints each replayed v2 line with the sense-check verdict).

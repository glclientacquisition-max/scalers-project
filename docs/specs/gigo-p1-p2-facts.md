# GIGO P1/P2 business facts: schemas, readers, read tools (Brain)

**Status:** Brain code on branch `brain/gigo-fact-schemas`. Not wired into the live prompt or Voice yet. No SQL.
**Lane:** Brain. Schema/RPC items below are a **proposal for Platform**, not a migration.

## What P1 and P2 mean (sources)

GIGO = garbage in, garbage out. Owner-entered business facts are the only thing the assistant may state.

| Phase | Meaning | Source |
| --- | --- | --- |
| P0 (merged) | Provenance envelope (`tenant_field_meta`), completeness score, hold gate. Seed and unconfirmed import count as unknown. | #570, #572, #575, #595, #598; `docs/platform/TENANT_FIELD_PROVENANCE.md` |
| **P1** | "Structured schemas and a Settings panel for all 10 domains, plus Brain tools that read them." | `docs/STATUS.md` section 7 (PR #619) |
| **P2** | "Deep BI loop: unmet demand, staleness re-verify, digest." | `docs/STATUS.md` section 7 (PR #619) |

The 10 domains are the ones `tenant_completeness_score` scores in `docs/supabase/tenant_field_provenance.sql`:
identity, catalog, hours, locations, payments, policies, faqs, team_notify, assistant, bulletin.
Field paths follow `docs/platform/TENANT_FIELD_PROVENANCE.md` and `dashboard/src/lib/fieldPathRegistry.ts`.
`docs/product/BUSINESS_INTELLIGENCE_ROADMAP.md` uses "Phase 1/2" for the Retail and Home packs. That is a different numbering from GIGO P1/P2.

## Files

| File | Role |
| --- | --- |
| `src/conversation/gigo/factValidate.js` | Validators. Missing or garbage is marked, never defaulted. |
| `src/conversation/gigo/factSchema.js` | `GIGO_DOMAINS`, `FACTS` (scalar fact defs), `CATALOG_LEAVES` |
| `src/conversation/gigo/factReaders.js` | Readers, unknown line, prompt block |
| `src/conversation/gigo/factTools.js` | Read-only tool declarations and runner |
| `src/conversation/gigo/index.js` | Barrel |
| `tests/gigoFacts.test.js` | Unit tests (in `npm run test:brain`) |
| `src/conversation/provenance.js` | `indexFieldMeta` keeps `last_verified_at` / `stale_after_days` / `value_hash`; `FACT_HASH_MODE`-gated `classifyRecord`; exports `lookupFieldMeta`, `productFieldPath`, `serviceFieldPath`, `faqFieldPath`, `policyMeta`, and the hash helpers |
| `src/conversation/factHash.js`, `dashboard/src/lib/factHash.ts` | Confirm v2 normalise-and-hash helper (JS + pure-sync TS twin) and `factValueForPath` |
| `tests/fixtures/factHashVectors.json`, `tests/factHash.test.js` | Shared vectors both twins must pass |
| `src/lib/tenantFieldMetaSelect.js` | Column-tolerant `tenant_field_meta` select used by `src/db.js` |

## Schema (P1)

| Key | Domain | field_path | Stored on | Validator | Speakable |
| --- | --- | --- | --- | --- | --- |
| `identity.business_name` | identity | `identity.business_name` | `tenants.business_name` | text | yes |
| `identity.vertical` | identity | `identity.vertical` | `tenants.vertical` | retail / home_services / hospitality (`general` = missing) | no |
| `identity.primary_phone` | identity | `identity.primary_phone` | `tenants.sautikit_virtual_number` | phone | no |
| `hours.weekly` | hours | `hours.weekly_grid` | `hours_schedule`, else `business_hours` text | parsed grid or text; an unparseable grid is garbage | yes |
| `locations.branches` | locations | `locations.branches` | `business_locations` | at least one row with address, landmark, or directions | yes |
| `locations.coverage_areas` | locations | `policies.coverage_areas` | `business_policies.coverage_areas` | picker ids; empty list = missing | yes |
| `payments.methods` | payments | `policies.payment` | `business_policies.payment` | text, pack seed = unconfirmed | yes |
| `payments.deposit` | payments | `policies.deposit` | `business_policies.deposit` | text | yes |
| `policies.{returns,delivery,cancellation,warranty,other}` | policies | `policies.<key>` | `business_policies.<key>` | text | yes |
| `team_notify.whatsapp` / `.email` | team_notify | `team.notify.*` | `whatsapp_notification_number`, `alert_email` | phone / email | **no** |
| `assistant.agent_name` | assistant | `assistant.agent_name` | `agent_name` (`Receptionist` fill = missing) | text | yes |
| `assistant.tone` | assistant | `assistant.tone` | `agent_tone` | professional / warm | no |
| `bulletin.active` | bulletin | `bulletin.items` | `daily_bulletin` (active now) | text list | yes |
| catalogue rows | catalog | `catalog.service.<n>.name`, `catalog.product.<sku\|n>.name` | `services_catalog`, `product_catalog` | name text; leaves below | yes |
| FAQs | faqs | `faqs.<n>` | `faqs` | confirmed Q and A | yes |

Catalogue leaves (provenance rides on the row's name path):

| Leaf | Read from | Valid | Volatile (P2) |
| --- | --- | --- | --- |
| `price` | product `price`; service `price_range` (+ `price_mode` / `pricing_mode`) | an amount > 0, or quote/free wording, or mode `ask`. `tbd`, `0`, negatives, words with no amount are garbage. | yes |
| `in_stock` | `in_stock` | explicit yes / no only. `unknown`, `maybe`, empty = missing. | yes |
| `lead_time` | `lead_time` / `eta` (**not stored today**, see proposal) | text with a duration word ("2-3 days", "same day", "siku mbili"). A bare number is garbage. | yes |

Provenance uses the P0 rules unchanged (`classifyRecord`): only `owner` or an explicit confirm is fact; `seed`, `import` (until confirmed), `inferred`, `call_suggested` are unknown. With no meta row, pack seed text is seed and other text is owner (the P0 fallback).

## Readers and tools

Reading shape: `{ key, domain, phase, topic, fieldPath, speakable, status: 'known'|'unknown', value, reason, source, stale }`.
`reason` is `missing` | `garbage` | `unconfirmed` | `stale` | `no_such_fact`. `value` is always `null` when unknown.

| Function | Signature | Returns |
| --- | --- | --- |
| `readFact` | `(profile, key, { now }) ` | one reading |
| `readDomain` | `(profile, domain, { now })` | readings for that domain |
| `readCatalog` | `(profile, { now })` | `{ status, reason, services[], products[], unconfirmedCount, garbageCount }`; each item has `price`, `in_stock`, `lead_time` leaf readings |
| `readFaqs` | `(profile)` | `{ status, faqs[], unknownTopics[] }` |
| `lookupCatalogItem` | `(profile, query, { now })` | `found` + item, `not_listed` (confirmed catalogue, no match), `unknown` (no confirmed catalogue, so "we don't sell that" can't be said either) |
| `checkCoverage` | `(profile, place, { now })` | `covered` / `not_covered` / `unknown` (no confirmed list: never "outside coverage") |
| `readAllFacts` | `(profile, { now })` | all 10 domains |
| `unknownFactLine` | `({ topic, language, afterHoursMode })` | the line to speak |
| `formatGigoFactsForPrompt` | `(profile, { now })` | CONFIRMED BUSINESS FACTS block + P0 UNKNOWN section |
| `runFactTool` | `(name, args, profile, { language, now })` | `{ ok, tool, status, value?, reason, say? }`; never throws |

Read-only tool declarations (`GIGO_FACT_TOOLS`, native function shape for the fresh #536):

- `read_business_fact({ key })`. `key` is an enum of speakable keys only. Notify targets, vertical, DID, and tone are not readable.
- `lookup_catalog_item({ query })`. Returns price, stock, and lead time or `null` for each, plus `unknown: [...]` and a `say` line per unknown leaf.
- `check_coverage({ place })`.

The caller name is **not** a tool. It stays a code-held phone-file fact (`callerMemory` / name lock). Nothing here touches the socket, PCM, generation, stream ids, the speech hold, or `formatNameConfirmSpeech`.

## How a missing fact is spoken

| Mode | English | Kiswahili / Sheng |
| --- | --- | --- |
| Serve (full assistant) | "I don't have the {topic} confirmed. Let me confirm with the owner." | "Sina habari hiyo kwa uhakika. Nitathibitisha na mwenye biashara." |
| Message (take-message) | "I don't have the {topic} confirmed. I can take a message for the owner." | "Sina habari hiyo kwa uhakika. Naweza kuchukua ujumbe kwa mwenye biashara." |

There's no callback promise (a callback is spoken only after a callback row is saved), no guessed value, and no vendor names. Each line is under 25 words.

## Proposal for Platform (no SQL in this branch)

1. ~~`listTenantFieldMeta` selects `last_verified_at, stale_after_days`~~ Done (confirm v2 section below), with `value_hash` and a column step-down.
2. Optional catalogue leaf `lead_time` (text) on `product_catalog` / `services_catalog` JSON rows. That needs Desk to add the field and allow `catalog.*.lead_time` in `fieldPathRegistry`. Until then, lead time is always unknown.
3. Leaf provenance paths (`catalog.product.<sku>.price`, `.in_stock`) only if owners need to confirm a price separately from the row. Today the leaves follow the row.

## P2 design note (deep BI loop, not built)

| Part | What | Depends on |
| --- | --- | --- |
| Unmet demand | When a reader returns `unknown` or `lookupCatalogItem` returns `not_listed` / `unknown` on a call, log `{ tenant_id, call_id, fact_key or query, reason }` (PII-free). It feeds the gap queue. | `readFact`, `lookupCatalogItem`, `checkCoverage` results; a Platform table (proposal) |
| Staleness re-verify | `freshness()` marks a fact stale when `last_verified_at` (or `confirmed_at`) is older than the row's `stale_after_days`. A stale **volatile** leaf (price, stock, lead time) is spoken as unknown. A stale policy stays known and is flagged for re-confirm (`factsToReconfirm`). Flag off: only the meta row's `stale_after_days` counts. `FACT_HASH_MODE=on`: the locked `DEFAULT_STALE_AFTER_DAYS` fill in when the row has none (see Default shelf life). | `freshness`, `factsToReconfirm`, Platform select change (1) |
| Digest | A weekly owner list: top unmet asks, stale facts, unconfirmed imports, in plain nouns ("3 callers asked for a price on Sofa cleaning"). | `readAllFacts` + unmet-demand log |

## Confirm v2: value_hash (Brain side)

Desk owns the SQL (`docs/supabase/tenant_field_confirm_v2.sql`: `tenant_field_meta.value_hash`, `confirm_tenant_fields(paths[], hashes[])`, `reopen_tenant_field`). Brain owns the hash and the readers.

**Hash.** `hashFactValue(value)` = sha256 hex of the UTF-8 canonical JSON:

- Strings: NFC, trim, inner whitespace (JS `\s+`, including NBSP) to one space, case kept. A plain decimal string matching `^-?(0|[1-9]\d*)(\.\d+)?$` becomes canonical decimal text (`"600.00"` → `"600"`, `"-0"` → `"0"`). Leading-zero phones and `1,500` stay text.
- Numbers: canonical decimal string with no exponent, so `600` and `"600.0"` hash the same. NaN and Infinity become `null`.
- Booleans as JSON. `null` as null. `undefined` is dropped from objects and is `null` at the top level or in arrays.
- Arrays keep their order. Object keys are NFC and sorted by UTF-16 code units (`Array.prototype.sort`).

JS: `src/conversation/factHash.js` (node crypto). TS: `dashboard/src/lib/factHash.ts` (pure sync sha256, `TextEncoder` only, safe in the client graph because `provenance.ts` is imported by client components through `onboarding.ts` / `promptCompiler.ts`). Both pass `tests/fixtures/factHashVectors.json` (36 vectors).

**What a path hashes** (`factValueForPath(path, tenantsRow)`, the same in both twins):

| field_path | Hashed value |
| --- | --- |
| `identity.*`, `hours.weekly_grid`, `locations.branches`, `team.notify.*`, `assistant.*`, `bulletin.items` | the tenants column as stored (`hours_schedule` object, `business_locations` array, …) |
| `policies.<key>`, `payments.methods` | `business_policies.<key>` (`payments.methods` = `payment`) |
| `policies.holds`, `policies.holds.allowed` | `holds.allowed ?? holds.enabled ?? holds_allowed` |
| `policies.coverage_areas` | the stored array, order kept |
| `faqs.<n>` | `{ question, answer }` only |
| `catalog.service.<id\|n>.name`, `catalog.product.<sku\|n>.name` | the whole row minus envelope keys (`source, status, confirmed*, envelope, field_meta, meta, provenance, value_hash`) and minus empty leaves (`""`, `null`, `[]`). A price, stock, or lead-time edit reopens the row. |

**Readers: `FACT_HASH_MODE` flag.** Hash mode is on only when `FACT_HASH_MODE` is exactly `on` (default off; `true`, `ON`, `1` are off).

- JS (`provenance.js`, `gigo/factReaders.js`, `gigo/factTools.js`): an explicit `{ hashMode }` option wins, then `fieldMeta.hashMode` (set by `indexFieldMeta(rows, { hashMode })` / `withHashMode`), then `process.env.FACT_HASH_MODE === 'on'`.
- TS (`dashboard/src/lib/provenance.ts`): `isConfirmed(row, { hashMode })`, `classifyRecord(..., hashMode)`, `buildCompileSections({ hashMode })`, `indexFieldMeta(rows, { hashMode })`. It never reads env, so client code must pass it (no `NEXT_PUBLIC`). The server helper `loadCompileProvenance` in `tenantFieldProvenance.ts` defaults it from `factHashModeFromEnv()`.
- **Flag off:** the P0 rules exactly, even when rows carry `value_hash` (the old auto-detect on the column is removed).
- **Flag on:** a path is fact only when a meta row exists with `source = 'owner'` **and** `value_hash === hashFactValue(current value)`. **No meta row means unconfirmed** (this replaces the P0 fallback where unmarked text counts as owner). A missing column, or no table, behaves as no hash, so the path is unconfirmed. A null or empty hash is not confirmed. An import with `confirmed_at` but no owner source is not confirmed. The table row beats in-data `source: 'owner'` / `confirmed` hints. The result carries `hashCheck: 'match' | 'mismatch' | 'missing' | 'no_row'`.
- Do not turn the flag on until the backfill below has run for that environment, or every owner fact reads as unconfirmed. The `tenant_hold_gate` RPC still checks owner meta, not hashes.

**Backfill (`scripts/backfillFactHashes.js`, one-time, not run by this branch).** For each `tenant_field_meta` row with `source = 'owner'` and no `value_hash`, it writes `hashFactValue(factValueForPath(field_path, tenantsRow))` as lowercase hex, using the stored tenants row.

```
node scripts/backfillFactHashes.js --tenant <uuid> [--tenant <uuid> ...]      # dry run
node scripts/backfillFactHashes.js --all-except <uuid,uuid> --apply           # write
  --sample N            rows to print in the sample (default 5; paths + hashes only, never values)
  --i-have-alvin-ok     required for any target that is not staging or local
```

- A scope is required: `--tenant` (repeatable) or `--all-except`.
- Guard: host `sgcdncjxauhsbunobmob.supabase.co` (staging) and local hosts (`localhost`, `127.0.0.1`, `::1`, `*.localhost`, `host.docker.internal`) run. Anything else, including prod ALCR `fjxcdccgyhnvnnlnovcl` (`docs/operations/ENVIRONMENTS.md`), is refused (dry run too) unless `--i-have-alvin-ok` is passed. The guard runs before a client is created.
- It skips empty values (null, blank text, `[]`, `{}`, a catalogue row with no name, a FAQ missing a question or answer), so it never confirms an empty value. It reports unresolved rows (`unknown_path`, `row_not_found`, `tenant_not_found`). It never overwrites an existing `value_hash` (counted as `kept_existing`), so it is idempotent and won't re-confirm an edited value. Updates are guarded with `.is('value_hash', null)`.
- Exit codes: 0 ok, 1 write errors, 2 bad args or guard refusal, 3 `value_hash` column missing, 4 read error.

**Service ids.** `catalog.service.<id>.name` when the row has a non-numeric id matching `[A-Za-z0-9_-]{1,64}` (uuid or `svc_…`). Otherwise the 1-based position. Pure-digit ids fall back to the position so they can't collide with index paths. Products keep `sku`, then position.

**listTenantFieldMeta.** `src/db.js` (and the Desk server twin in `tenantFieldProvenance.ts`) select `field_path, source, confirmed_by, confirmed_at, last_verified_at, stale_after_days, value_hash`. On a missing-column error (42703 / PGRST204 / "does not exist" / "schema cache" naming one of those columns) they step down to the same list without `value_hash`, then to the P0 four. A missing table still returns null as before.

## Default shelf life (LOCKED: approved by Alvin 2026-10-09)

A confirmed fact turns stale `stale_after_days` after `last_verified_at` (or `confirmed_at`). A stale **volatile** fact (stock, price, lead time) reads as unknown. A stale non-volatile fact is still spoken and is flagged for the owner to re-confirm (`reconfirm: true` on the reading, `readFaqs().reconfirm`, and `factsToReconfirm(profile)` for the queue).

In code: `DEFAULT_STALE_AFTER_DAYS` in `src/conversation/gigo/factSchema.js`; each scalar fact carries a `shelfLife` key into it. Rules:

- Gated by `FACT_HASH_MODE`. With the flag off nothing changes: only an explicit `stale_after_days` on the meta row makes a fact stale, and readings carry no `reconfirm` key.
- With the flag on, the meta row's own `stale_after_days` wins. The default is used only when the row has none.
- Catalogue rows: the meta row lives on the name path. An explicit row `stale_after_days` covers every leaf. Otherwise each leaf uses its own default (price 30, stock 3, lead time 14), and the row is flagged when any leaf is stale.
- No `last_verified_at` / `confirmed_at` means not stale (the hash check still decides whether it is a fact).

| Field | Days | Volatile | Reason |
| --- | --- | --- | --- |
| Stock (`in_stock`) | 3 | yes | Shelves change daily. A week-old "yes" is how a caller makes a wasted trip. |
| Price (catalogue price / range) | 30 | yes | Kenyan SME prices move with input costs and fuel. Monthly is the most an owner will tolerate re-confirming. |
| Lead time / ETA | 14 | yes | Depends on current workload and supplier, which drift within weeks. |
| Bulletin items | none | n/a | They already carry their own `ends_at`. |
| Hours | 90 | no | Changes seasonally (Ramadan, December, school terms). Quarterly catches those. |
| Coverage areas | 180 | no | Coverage follows team size and transport, which change slowly. |
| Payments (methods, till, paybill) | 180 | no | Rarely changes, but a wrong till number costs money, so twice a year. |
| Deposits | 90 | no | Tied to pricing policy. Re-check with the hours cycle. |
| Policies (returns, delivery, cancellation, warranty) | 180 | no | Stable owner rules. Twice a year is enough to catch drift. |
| FAQs | 180 | no | Answers drift as the business changes. Re-confirm with policies. |
| Locations / directions | 365 | no | A shop rarely moves. An annual check catches new landmarks. |
| Identity (name, business type, line) | none | no | Changes only by an explicit owner edit, which reopens it via the hash anyway. |
| Assistant (name, tone), notify targets | none | no | Owner settings, not caller facts. An edit reopens them. |

## Not done here (needs Alvin/Chief GO)

- Wiring `formatGigoFactsForPrompt` into `buildLiveGroundTruth` / `src/prompts.js`, or `runFactTool` into the turn. Both change live calls and should go to staging first.
- Desk Settings panel for the 10 domains (Desk lane).

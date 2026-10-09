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
| `src/conversation/provenance.js` | Additive: `indexFieldMeta` keeps `last_verified_at` / `stale_after_days` when loaded; exports `lookupFieldMeta`, `productFieldPath`, `serviceFieldPath`, `policyMeta` |

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

1. `listTenantFieldMeta` in `src/db.js`: also select `last_verified_at, stale_after_days`. The columns already exist on `tenant_field_meta`. Until then, P2 staleness can't trigger.
2. Optional catalogue leaf `lead_time` (text) on `product_catalog` / `services_catalog` JSON rows. That needs Desk to add the field and allow `catalog.*.lead_time` in `fieldPathRegistry`. Until then, lead time is always unknown.
3. Leaf provenance paths (`catalog.product.<sku>.price`, `.in_stock`) only if owners need to confirm a price separately from the row. Today the leaves follow the row.

## P2 design note (deep BI loop, not built)

| Part | What | Depends on |
| --- | --- | --- |
| Unmet demand | When a reader returns `unknown` or `lookupCatalogItem` returns `not_listed` / `unknown` on a call, log `{ tenant_id, call_id, fact_key or query, reason }` (PII-free). It feeds the gap queue. | `readFact`, `lookupCatalogItem`, `checkCoverage` results; a Platform table (proposal) |
| Staleness re-verify | `freshness()` marks a fact stale when `last_verified_at` (or `confirmed_at`) is older than the row's `stale_after_days`. A stale **volatile** leaf (price, stock, lead time) is spoken as unknown. A stale policy stays known and is queued for the owner to re-confirm. Brain sets no shelf life. Only the meta row does. | `freshness`, Platform select change (1) |
| Digest | A weekly owner list: top unmet asks, stale facts, unconfirmed imports, in plain nouns ("3 callers asked for a price on Sofa cleaning"). | `readAllFacts` + unmet-demand log |

## Not done here (needs Alvin/Chief GO)

- Wiring `formatGigoFactsForPrompt` into `buildLiveGroundTruth` / `src/prompts.js`, or `runFactTool` into the turn. Both change live calls and should go to staging first.
- Desk Settings panel for the 10 domains (Desk lane).

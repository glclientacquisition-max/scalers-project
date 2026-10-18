---
owner: platform
last_reviewed: 2026-10-18
---

# Fact references (VOICE_FACT_REFS) and the value_hash backfill

## What the flag does

`VOICE_FACT_REFS` (default off) turns on fact references for the v1 brain.

- `src/conversation/factSheet.js` builds a fact sheet from live data only: Catalogue prices, area fees (`profile.areaTerms`, needs `VOICE_AREA_FEES` from #769), hours (`hours_schedule`) and payment numbers (`business_policies.payments`).
- The FACT CARD sits inside LIVE GROUND TRUTH (`liveKnowledge.js`), so it travels with the cacheable prefix when #779 lands.
- The model writes IDs such as `{price.sofa_cleaning}`. Code renders the value in the caller's language. An unconfirmed or unknown ID becomes the cannot-answer line (below).
- A local answer the Business Assistant already spoke (for example an area fee) is folded into the next model turn as "already answered aloud", so the model does not say it again.
- `llm_system_prompt` is kept for persona only; its amounts, clocks, phone numbers and fact sections are stripped (`personaOnlyPrompt`).
- The speech check (`speechGuard.js`) repairs a dropped number sentence with the matching file fact, or the cannot-answer line, never silence. It also accepts compound Swahili numbers and saves made earlier in the call.

The flag-off path is byte-identical to main (tests in `tests/factSheet.test.js` check both).

## The cannot-answer line

Owner decision, 18 Oct 2026. `factSheet.pickUnknownAnswerLine(profile, language)` picks, in this order:

1. `tenants.unknown_answer_spoken` (jsonb `{en, sw, source, updated_at}`, written by the Desk): the caller's language, only while `source` equals the trimmed `unknown_answer_fallback`.
2. `unknown_answer_fallback` as written, only when it is clearly in the caller's language (`analyzeCallerLanguage`, confidence 0.5 or more; Sheng counts as Swahili).
3. The team default: "Let me check with the team and get back to you." / "Wacha niulize timu kisha nikujulishe."

Every candidate passes `callbackSafeLine` first: no transfer (`TRANSFER_CLAIM`), no saved or booked claim (`SAVED_CLAIM`, booking words), no job-close line. A line that fails falls to the next step. The column is read in its own query, only with the flag on (`loadUnknownAnswerSpoken` in `db.js`); a missing column or any error gives null. With the flag on, the GIGO unknown-fact line (serve mode) and the prompt's UNKNOWN block also use the team wording instead of "confirm with the owner".

## Replay eval

`npm run eval:fact-refs` replays 69 judged production and staging speech-check rows (`tests/fixtures/fact-refs-eval/`). It prints false deletions and false "not on file" before and after. `npm run test:fact-refs` fails if the after numbers regress.

## value_hash backfill (prod, not run)

Production `tenant_field_meta` has owner rows with no `value_hash`, so the provenance filter treats none of them as confirmed. The backfill stamps each owner row with the hash of the value stored today.

Do not run this on production without Alvin's explicit yes.

1. Export, read-only (Supabase SQL editor or MCP), as one JSON object `{tenants: [...], field_meta: [...]}`. `tenants` needs `id` and every column `factValueForPath` reads (`business_name`, `vertical`, `sautikit_virtual_number`, `spoken_name`, `social_handles`, `hours_schedule`, `business_locations`, `business_policies`, `whatsapp_notification_number`, `alert_email`, `notify_channels`, `agent_name`, `agent_tone`, `agent_tools`, `daily_bulletin`, `faqs`, `services_catalog`, `product_catalog`). `field_meta` needs `tenant_id`, `field_path`, `source`, `value_hash`. Keep the export out of the repo.
2. Plan: `node scripts/plan-value-hash-backfill.js export.json --date YYYYMMDD > backfill.sql`. It never connects to a database. It prints the stamped and skipped counts on stderr.
3. Review `backfill.sql`. Step 1 copies the whole table into `tenant_field_meta_backup_<date>` and compares row counts. Step 2 updates inside one transaction, only where `source = 'owner' and value_hash is null`. Step 3 is a commented rollback from the backup.
4. Re-export right before running. Any Desk edit after the export changes the value, so re-plan if time has passed.

Rollback: run the commented step 3, then drop the backup table once the restore is checked.

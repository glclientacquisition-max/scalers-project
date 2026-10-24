---
owner: platform
last_reviewed: 2026-10-22
---

# N+1 query audit: Scalers (21 Oct 2026, EAT)

> Reference copy of the Platform box brief `briefs/n-plus-one-audit-2026-10-21.md` (read-only audit, 21 Oct 2026). Paths under `/workspace/` are box paths and are not in the repo. Voice items are in draft #859 (`VOICE_QUERY_BATCHING`, off); Desk items shipped in #860 and #858.

Read-only audit. I made no commits, PRs or writes. Staging DB was read with SELECTs on pg_stat_statements only.

- **Code:** `main` @ `200d9c27` (worktree `/workspace/wt-n1`). PR #855 head `f1be1d51` (`brain/v2-c7-tools-shadow`, worktree `/workspace/wt-n1-855`).
- **Method:** I wrote an AST scanner (`/workspace/tools/n1scan/scan.js`) that flags DB calls (`.from()`, `.rpc()`, `fetch`, plus helpers that reach them) inside `for`/`while`/`.map`/`.forEach`/`Promise.all`. It flagged 626 hits; I read each likely one by hand. I also traced the call-start path by hand, because the worst problem there is a chain of one-after-another queries, not a loop.
- **Staging evidence:** Supabase `scalers-staging` pg_stat_statements, counted since 15 Aug (955 calls, 6 tenants). Staging traffic includes smoke and eval runs, so treat the per-call ratios as rough.

## Verdict

**Yes, but it's mild.** There's no classic "one query per row" on the list pages:
- Inbox, Contacts, the contact timeline and the Super Admin business list all batch with `.in()` or `Promise.all` over fixed queries.
- The live turn loop doesn't hit the DB per turn. The profile is cached per call in `callTenantProfiles`; the only per-turn write is the voice-trace insert.

The real problems are three things:

1. **The call start runs about 9–18 queries one after another** (tenant row, then visits, then service areas, then provenance ×2, then the unknown-answer line, then getCall, then the caller card ×5–10). The greeting waits for all of them.
   - This is the main reason `connect_to_greeting_pcm_ms` is about 500–1,085 ms even when the greeting audio is already cached. The target is 600 ms.
2. **The same rows get reloaded many times per call.** Staging shows about 14 `getCall`-by-sid reads and about 4.5 full profile loads per call (the separate service_areas and unknown_answer_spoken queries each run about 4.5× per call).
3. **A few Desk write paths loop.** Settings attest (up to 80 paths × 3 queries), Overview prices (a full save and recompile per item), and inbox bulk actions (one server action per selected row).

Nothing here is an outage risk at 6 tenants. Items 1 and 2 hit caller-perceived latency now. Items 3, 4 and 6 (greeting warm sweep, Admin Today count) grow with tenant count.

## A. Real hot-path issues (fix these)

| # | file:line | What loops over what | Rough N in practice | User impact | Lane | Batched fix (one line) |
|---|---|---|---|---|---|---|
| 1 | `server.js:2625` → `src/db.js:1577-1640` (`getTenantProfile`) + `src/conversation/callerMemory.js:1082` + `src/db.js:2016-2066` (`getCallerMemory`) | One-after-another chain at call start: `selectTenantRowWithLine` → `listOpenAppointments` → `getTenantServiceAreas` → `listTenantFieldMeta` → `tenant_hold_gate` RPC → `loadUnknownAnswerSpoken` → `getCall` → contact → 5 caller-card helpers (each tries contact_id, then the phone fallback). The greeting waits at `server.js:5392`. | 9–18 round trips per call, all on the critical path | **Live call latency.** Dead air before the greeting; cached-PCM greetings still take 0.5–1.1 s. `tenant_hold_gate` alone is about 9 ms of DB time plus the network. | Voice (owner), Brain (card shape) | Put `service_areas` and `unknown_answer_spoken` in the main tenant select. Run visits, field_meta, hold_gate and the caller card in one `Promise.all`. Or replace the whole thing with one `call_start_bundle(p_tenant_id, p_phone)` RPC that returns tenant, visits, provenance and card as one JSON (drop `listNextAppointmentForCaller`, which is the first row of the open-visits list). |
| 2 | `server.js:1418, 5848, 6108, 6202, 6303` (`maybeSend*Notification`, missed textback) | Each notification calls `db.getTenantProfile({callSid})` again, which re-runs most of the chain in #1 (getCall, tenant, visits, areas, provenance ×2, unknown line). | 3–5 reloads × about 7 queries per call. Staging shows about 4.5 profile loads per call. | Not heard by the caller (fire-and-forget), but about 25–35 wasted queries per call, plus slower owner alerts. | Voice | Read `callTenantProfiles.get(callSid)` first; otherwise use a light `getTenantNotifyFields(tenantId)` (one select: name, whatsapp number, notify_channels, team_directory). |
| 3 | `src/db.js:870` (`mergeCallSummaryMeta`), `:621` (`appendTranscript`), `:671`, plus 9 direct `db.getCall` sites in `server.js` | Every summary merge or transcript write first re-reads `calls.*` by sid, then writes. | About 14 `getCall` reads per call on staging (13.6k for 955 calls) and about 4.7 summary updates per call | Background write cost. Each merge is also a read-then-write race on `calls.summary`. | Voice | Keep `call.id` on the session after `upsertCall`. Do the merge in SQL: `rpc merge_call_summary(p_sid, p_patch jsonb)`, using `summary::jsonb \|\| patch` in a single UPDATE. |
| 4 | `dashboard/src/lib/ownerAttestFields.ts:54` (`ownerAttestFields`, used when `FACT_HASH_MODE` is off) via `settings/actions.ts:675`, `alertsActions.ts:91`, `bulletinActions.ts:70`, `setupActions.ts:319`, `home/insightActions.ts:44` | For each saved field path: `confirm_tenant_field` RPC (plus `upsert_tenant_field_meta` if that fails), then `persistOwnerConfirm`, which re-reads `tenants` (catalogue, FAQs, policies) and UPDATEs the whole JSON column. | Up to 80 paths per save, so up to about 240 queries one after another, plus 80 whole-column rewrites | It runs in the background after Save, so the toast isn't slow, but it hammers the DB. It can also race the next save and overwrite it (last-writer-wins on `product_catalog`/`faqs`). | Desk | Use the hash-mode path everywhere: one `confirm_tenant_fields` batch RPC (it already exists and caps at 500), plus a single `persistOwnerConfirm` that patches every path in one read and one write. |
| 5 | `dashboard/src/app/(desk)/settings/overviewActions.ts:68` (`saveOverviewPricesAction`) | For each item, `confirmPriceAction` runs member check, workspace, catalogue read, tenant UPDATE, `restampPriceHash` (read + confirm RPC), `loadCompileProvenance` (2 RPCs), prompt compile and prompt UPDATE. | Items in the "prices" sheet (about 3–20), × about 8–10 round trips each, one after another | **Owner-facing save latency** (seconds), plus N prompt recompiles where 1 would do | Desk | Apply all prices to one catalogue copy in memory, then do one UPDATE, one batch hash restamp and one recompile. |
| 6 | `dashboard/src/components/InboxRowSelect.tsx:165` (bulk Confirm/Done/Mark done/Archive/Unarchive), `InboxArchiveToast.tsx:34` (Undo) | The client loop awaits one server action per selected row. Each action is its own HTTP request that redoes auth, member, tenant and workspace checks, then 1 UPDATE and 3 `revalidatePath` calls. | Number of rows selected (a page holds up to 150), about 0.3–0.6 s each | **Owner-facing.** Bulk-archiving 30 rows takes about 10–15 s with a spinner. | Desk | Add `inboxBulkAction(kind, ids[])` that runs one `.in("id", ids)` UPDATE per table and revalidates once. |
| 7 | `dashboard/src/lib/adminToday.ts:55` (`businessesWithRecentCalls`) | `Promise.all(ids.map(...))`: one `count(*)` on `calls` per business | Every business on Super Admin home (6 now; scales linearly) | Super Admin page slowness at scale (parallel N+1: N round trips and N index scans) | Ops & Billing (Super Admin) | One RPC: `select distinct tenant_id from calls where created_at >= $since and tenant_id = any($ids)`. |
| 8 | `src/speech/greetingWarm.js:184` + `server.js:1181` | Every 5 min, `warmAll` runs `getTenantProfile` for every live tenant (serialised). That's the full #1 chain minus the card. | Tenants × about 7 queries every 5 min (about 21 now; about 3,500 at 500 tenants) | Background DB load that grows with tenants | Voice | Load greeting fields for all tenants with one `.in('id', ids)` select. Skip tenants whose greeting hash hasn't changed. |

## B. Real but harmless (small fixed N or background), fix opportunistically

| file:line | Loop | N | Why it's harmless | Lane | Fix |
|---|---|---|---|---|---|
| `src/notifications/sendLedger.js:252` | dest keys × 3 channels → `findNotifySend`, one after another | 3–6 per alert send, × recipients (`recipients.js:20`) | Runs when an alert is sent, not on speech | Voice (notify) / Ops & Billing | One `.in('idempotency_key', keys)` select |
| `dashboard/src/app/onboarding/actions.ts:291`, `settings/catalogActions.ts:325` | `upsert_tenant_field_meta` RPC per field, in parallel | ≤40 (catalogue import), about 30–70 (onboarding) | Runs once per import or onboarding | Desk / Platform | Bulk RPC that takes a jsonb array of `{path,value}` |
| `ownerAttestFields.ts:97` (`ownerConfirmPlan`) | `reopen_tenant_field` per cleared path | Usually 0–3 | Small | Desk | Fold into `confirm_tenant_fields` with a reopen array |
| `dashboard/src/components/AddContactPanel.tsx:65` | `createContact` per draft | 1–5 | Manual entry | Desk | `createContacts(drafts[])` |
| `dashboard/src/lib/didPool.ts:73` | insert or update per SautiKit number | Pool size (tens) | Admin "sync numbers" button | Ops & Billing | One `upsert(rows, {onConflict:'e164'})` |
| `server.js:6537, 6576, 6591` (legacy `/ws` relay) | Every turn: `getCall`, DELETE all transcript rows, re-INSERT all (O(n²) rows per call) | Per turn, but only on the legacy relay | The live `/ws/media` path flushes once at hangup (`server.js:5714`). Transcript DELETE averages 26.5 ms on staging. | Voice | Delete the legacy relay, or insert only the new turn |
| `server.js:1096, 1118, 1150` (`attachProviderRecording`) | `getCall` / merge / attach per sid | 1–3 sids | Recording webhook | Voice | Fine as is |
| `server.js:7514` (recording sweep), `src/lib/recordingRetention.js:70`, `dashboard/src/lib/invoicePay/retryReads.js:26/98`, `dashboard/src/lib/opsAlertsRun.ts:184/217` | Per row; mostly an external API call (SautiKit, Bachs, storage) per row | ≤10–50 per tick, about 10 alert kinds | Cron/background; the per-row work is inherently per row (external calls) | Voice / Ops & Billing | None needed. Retention already batch-loads its settings. |
| Schema-fallback ladders: `src/db.js:1501` (`selectTenantRowWithLine`), `getTenantById` (15 rungs), `inboxLoad.ts:111-157`, `ownerPlanLoad.ts:257-331`, `tenantLine.ts:13`, `adminBusinessActions.ts:54`, `admin.ts:125`, `src/db.js:344` | Retry the SELECT with fewer columns while the error says a column is missing | 1 on a current schema; k extra on an old one | Costs nothing today. If one column goes missing on prod, every call pays the extra rungs. | Platform | Drop the ladders once prod and staging schemas are verified (`scripts/verify-staging-schema.js`) |

## C. False positives ruled out

- **Name collisions (pure functions, no DB):** `storedPhoneCandidates` (handoffMode.ts:52), `pushChannel`/socialHandles, `noteDrop`/speechGuard, `readFact`/`readDomain`/`readCatalog` (GIGO factReaders, in memory), `packageUsageGap`, `rollupBusiness`, `lookup` in assistantSayReadiness (in-memory knowledge), `inboxRecordHref`/`inboxPileHref`.
- **JSX `.map` onClick handlers** (one action per click, not per render): MembersPanel, DidPoolManager, AdminBusinessesPanel, PronunciationCoach, NoticeList, BillingHistory, AdminBillingShopInvoices.
- **Inbox load** (`inboxLoad.ts`): calls, holds and jobs run in `Promise.all`; owner facts and contact names are each a single `.in()`. Inbox has no per-row contact lookup.
- **Contacts** (`contactsLoad.ts`): page, pile counts, last-contact map and timeline are all single `.in()` / `Promise.all` queries.
- **Desk request-level reloads:** `getCurrentTenant`, `createWorkspaceDataClient` and `memberRowsForUser` are wrapped in React `cache()`. `tenant_members` runs about 34 times per staging call-equivalent, but that's one query per Desk request (0.12 ms), not N+1.
- **Inbound webhook:** the old 6-query chain was already fixed by `src/sautikit/inboundDirectory.js` (cached directory, `VOICE_FAST_INBOUND` default on). `attachPackageStatus` is a single batch.
- **Live turn loop:** no tenant or profile reload per turn (cached in `callTenantProfiles`, `callBrainStates`). Each turn writes one `voice_turn_traces` insert and update, which is expected.
- **`listCallerAppointmentsForReview` paging** (`db.js:1978`): pages of 100, only when a caller asks to review visits.
- **PR #855 (Brain v2 C7):** the scanner diff against main adds no DB calls in loops. `src/conversation/v2/*` has no DB access. `spoken_catalogue` rides the existing tenant select. `brain_write_receipts` is a single upsert per phase (≤5 per write). `spokenCatalogueOnSave` coalesces repeat runs. **No new N+1.**

## Staging pg_stat_statements (since 15 Aug; 955 calls, 6 tenants)

| Query shape | Count | ≈ per call | Mean DB time |
|---|---|---|---|
| `calls.*` by `sautikit_call_sid` (getCall) | 13,584 | 14.2 | 0.2 ms |
| `tenant_hold_gate` RPC | 7,990 | 8.4 | 9.1 ms |
| `tenant_field_meta` read | 7,775 | 8.1 | 0.8 ms |
| full tenant row (with `llm_system_prompt`) | 5,826 | 6.1 | 1.1 ms |
| `calls.summary` UPDATE (merge) | 4,442 | 4.7 | 0.7 ms |
| caller-card contact lookup | 4,429 | 4.6 | 1.4 ms |
| `tenants.service_areas` own query | 4,399 | 4.6 | 0.1 ms |
| `tenants.unknown_answer_spoken` own query | 4,121 | 4.3 | 0.05 ms |
| transcripts DELETE (full rewrite) | 1,054 | 1.1 | 26.5 ms |

DB time per query is tiny. The cost is the number of network round trips (Railway → Supabase eu-west-2), each typically tens of ms, and in #1 they run one after another before the greeting.

## Suggested order

1. **Voice #1 + #2:** one call-start bundle and a reused profile. This is the only change a caller would hear: it should get cached greetings under 600 ms. Test it the same way: measure `connect_to_greeting_pcm_ms` over 10 staging calls, before and after.
2. **Desk #6 + #5:** bulk inbox actions and the Overview prices batch. Owners feel these.
3. **Desk #4:** move every save onto the batch confirm (or turn `FACT_HASH_MODE` on). This also closes the catalogue/FAQ overwrite race.
4. **#3, #7, #8, then section B:** hygiene and scale work.

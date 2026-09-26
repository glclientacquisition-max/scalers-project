# Platform system map

**Status:** Investigation snapshot plus P2 notify catalog  
**Date:** 2026-09-20  
**Baseline:** `main` @ `2e6d58d` (Company Brain v0.2.1 seated; #364 merged)  
**Audience:** Scalers Platform (seat 4486659), Product, Critic.  
**Authority:** [`../company/COMPANY_BRAIN.md`](../company/COMPANY_BRAIN.md) wins on wedge vs north star. This file maps **what the repo actually has**. Vocab: [`../product/DELIVERY_VOCAB.md`](../product/DELIVERY_VOCAB.md). SQL matrix: [`NOTIFY_SQL_CATALOG.md`](./NOTIFY_SQL_CATALOG.md).

How to use: §0 is the briefing. §§1–6 are the inventory. §7 is the only allowed incorporation order. Do not skip the wedge. Do not invent PSTN-as-product, Baileys, Instagram inbox, campaign send, or a fourth status machine.

---

## 0. Briefing (read this first)

**What Scalers is today:** a Kenya B2B **voice Business Assistant** (SautiKit + Soniox + Gemini on Railway) plus an owner **Desk** (Next.js on Vercel). Supabase is the system of record. The live product is **honest phone triage + async human notify**, not a multi-channel OS and not a softphone.

**What Company Brain wants later:** one business brain that can reply and campaign across WhatsApp (then Instagram) with delivery truth. That is the north star. The wedge is still #364 → whose-turn → inbox verb cut → contact strip.

**Platform seat (now):** channels, voice/notify contracts, Meta delivery *when the send stack is real*, wallet plumbing, campaign send plumbing *later*. Platform does **not** own desk chrome, whose-turn copy, or Critic vocab.

**#364:** already on `main` (`4430168`). Needs you row recipes are Product-owned. Release smoke is still the gate (Vercel Pro / 11:30 EAT 21 Sep routine). Platform does not ship a follow-up feature while that smoke is open.

**P2 (2026-09-20 probe):** ALCR is missing `notify_sends`, `whatsapp_threads`, `whatsapp_messages`, `sms_included_units`, `sms_used_units`. Staging has that stack. Runtime now skips / persists **failed** when the ledger or `consume_sms_units` is missing. SQL is still for Ops / SQL Editor on ALCR. This PR did not apply production SQL.

**Hard kills (forever unless founder reverses):** fake Online, Baileys / unofficial WA Web, PSTN live transfer as a product promise, parallel `lead_status` / Needs you / notify machines, Instagram or campaigns before wedge GO.

---

## 1. System map

Status: **live** = production path in code and used. **partial** = code exists, gated, incomplete, or identity-split. **docs-only** = specified or stubbed, not a product path. **dead** = superseded or parked. **blocked** = implemented enough to lie if claimed.

| Subsystem | What it is | Paths | Status | Honesty risk |
| --- | --- | --- | --- | --- |
| Voice inbound | SautiKit Stream XML → PCM `/ws/media` | `server.js` `/`, `/voice/incoming`, `/voice`; `src/sautikit/webhook.js` | **live** | None if Desk says the DID answers. Do not say “Online”. |
| Voice media / STT / TTS | Soniox realtime, 16 kHz PCM | `src/speech/*` | **live** | Outage speech is a recording + hangup, not a fake turn. |
| Voice events / recordings | Terminal + `recording.ready` | `server.js` `/voice/events`, `/voice/recording-status`; `src/sautikit/recording*.js` | **live** | Recording URL may lag; do not claim “recording ready” from call start. |
| Voice outbound PSTN | SautiKit `POST /v1/calls` for live transfer | `src/billing/liveTransferLegs.js` (gate only); no live originate in media path | **blocked** | See §2. Desk must not say Rings / transferred. |
| Live transfer executor | Cold Dial after Stream; conference REST is next | `src/sautikit/pendingLiveTransfer.js`; `server.js` `/voice/transfer`; `src/conversation/liveTransferReady.js` | **blocked** | Staging 2026-09-06: StreamStopped never re-POSTs Dial. Default `VOICE_LIVE_TRANSFER=off`. |
| Voice brain (live call) | Gemini turn + tools + playbooks | `src/prompts.js`, `src/conversation/*`, `server.js` `runGeminiTurn*` | **live** | Brain may say “texted the team” only after notify OK. Transfer copy only if `liveTransfer: true`. |
| Returning-caller card | Compact phone file at call setup | `src/db.js` `getCallerMemory`; `src/conversation/callerMemory.js`; ADR-0005 | **live** | Candidate by phone. Bind the speaker before using the name or visit. |
| Post-call review | Hangup Gemini JSON → `owner_review` | `src/conversation/callTranscriptReview.js` | **live** (kill: `POST_CALL_GEMINI_REVIEW=off`) | Lands 1–2 min after mid-call SMS. Do not SMS the four-block card. |
| Compile / live ground truth | Desk fields → `llm_system_prompt` + per-turn facts | `dashboard/src/lib/promptCompiler.ts`; `src/conversation/liveKnowledge.js` | **live** | Stale compile vs live facts: live ground truth wins. |
| Thin CRM | Contacts, holds/orders, visits | `contacts`, `service_requests`, `appointments`; `src/db.js` upsert/create helpers | **live** | Confirm / Done only when those rows exist (#364). |
| Staff notify | SMS → SautiKit WA → Resend | `src/notifications/*`; `server.js` `maybeSend*` | **live** | Soft/`desk_only` is **not** sent. Missing `notify_sends` → skip / **failed**, not sent. |
| Caller SMS | Opt-in confirmations | `src/notifications/callerSms.js`; `notify_channels.caller_sms` | **partial** | Default **off**. Templates exist. Do not imply every caller is texted. |
| Missed text-back | Separate opt-in on failed/no-answer | `src/notifications/missedTextback.js` | **live** (toggle off by default) | Promises callback only. No inbound SMS route. |
| Desk wa.me | Owner’s personal WhatsApp to the caller | `dashboard/src/components/WhatsAppLink.tsx`; `logWhatsAppFollowUp` | **live** | Click = opened / followed up. **Not** Meta delivery. Writes `lead_status=resolved` + note. |
| Platform WhatsApp Cloud | Scalers WABA via SautiKit | `src/notifications/whatsapp.js`; `src/sautikit/whatsappInbound.js`; `docs/supabase/whatsapp_threads.sql` | **partial** | Staff templates + inbound ack only. Same E.164 as Done and Dusted **voice**. No shop inbox. |
| Instagram / other social | Handles on the tenant profile | `tenants.social_handles`; `src/conversation/socialHandles.js` | **docs-only** as a channel | Brain may *read* a handle. There is no IG inbox, Graph, or send. |
| Wallet / ledger | One prepaid KES wallet | `docs/supabase/one_wallet_billing.sql`; `src/db.js` `chargeCallToWallet`; desk `/wallet` | **live** (beta meters, does not charge) | Do not show dual USD/KES as the product. M-Pesa top-up is a stub. |
| SMS allowance | Included segments, same on-demand toggle | `docs/supabase/sms_allowance.sql`; `consumeSmsUnits` | **live** if SQL applied; skip tenant SMS if RPC missing | Skip tenant SMS at cap (paid) or `rpc_missing`. Never debit KES for SMS. Never claim sent without a ledger row. |
| Packages / SKUs | Reserved email + seat columns | `docs/supabase/package_entitlements.sql`; [`../PACKAGES.md`](../PACKAGES.md) | **docs-only** | No shop UI. Do not gate email or invites. |
| DID pool | Assign / release Kenya numbers | `sautikit_did_pool`; admin APIs; [`../PRODUCTION_DID_POOL.md`](../PRODUCTION_DID_POOL.md) | **live** | `+254709221536` must never be `available`. |
| Auth (owner) | Supabase Auth JWT + RLS | `dashboard/src/lib/auth.ts`; `docs/supabase/owner_rls.sql` | **live** | Service role never in `NEXT_PUBLIC_*`. |
| Auth (Super Admin) | Better Auth username + access code | `admin-auth.ts`; `/admin/login`; `ADMIN_HOST` | **live** | Not owner auth. HMAC leftover only. |
| Deploy | Voice Railway, desk Vercel, DB Supabase | `Dockerfile`, `railway.toml`, `dashboard/vercel.json` | **live** | Stay on Vercel through the wedge. Cloudflare = later spike only. |
| Module split | `src/telephony/`, `LLM_PROVIDER` | [`../TARGET_MODULE_LAYOUT.md`](../TARGET_MODULE_LAYOUT.md) | **docs-only** | `server.js` is still the orchestrator. Do not rewrite it in this ladder step. |
| RAG / embeddings | `knowledge_chunks` | Blueprint + BI roadmap | **docs-only** | Not in `src/`. Do not plan mid-call retrieve. |
| Campaigns / growth send | Blast / re-engage | Company Brain §7 step 6 | **docs-only** | No engine. No Meta marketing templates in repo. |
| Baileys / WA Web | Unofficial session | — | **dead** (hard kill) | Do not add. |
| Twilio ConversationRelay | `/ws/relay` | `server.js` | **dead** (legacy wired) | Do not expand. |
| WhatsApp Calling | Meta calling on the Cloud number | `whatsappInbound.js` parks `calls` changes | **dead** (parked) | `scripts/smoke-whatsapp-did.js` FAIL is Calling-only. |
| Chatwoot / Twilio inbox shapes | External inbox | Company Brain notes | **docs-only** (deferred) | Not a native path. |

### Webhooks (voice host)

| Route | Job |
| --- | --- |
| `POST /`, `/voice/incoming`, `/voice` | SautiKit answer → `<Stream connect="true"/>` (or transfer continue) |
| `POST /voice/transfer` | Pending Dial XML (never product while flag off / conference unproven) |
| `POST /voice/events` | `call.completed` / recording; also demuxes WhatsApp if `X-Sautikit-Event-Kind` |
| `POST /voice/recording-status` | Attach recording |
| `POST /whatsapp/events` | Platform Cloud inbound + delivery statuses |
| `POST /internal/desk/escalate` | Desk Ping → same notify path (`VOICE_INTERNAL_SECRET`) |
| `GET /healthz` | Soniox / Gemini / notify / `liveTransfer.executor` |
| `POST /api/tts/preview` | Desk pronunciation preview |

Desk APIs (Vercel): login/logout/tenant, admin businesses/wallets/voices/DID/SautiKit sync, pronunciation preview. No shop WhatsApp composer route.

### State machines that already exist (do not add another)

| Machine | Values | Job |
| --- | --- | --- |
| `calls.lead_status` | `new` \| `contacted` \| `resolved` \| `archived` | Owner pile / file. `contacted` still Needs you. Mark done + wa.me write `resolved`. |
| Needs you | Derived in `inboxNeedsYou` | Attention. Visit requested, hold open, human/missed while lead open. Not a column. |
| `calls.resolution` | `resolved` \| `needs_human` \| `abandoned` \| `unresolved` \| `unknown` | Brain outcome. |
| `appointments.status` | `requested` \| `confirmed` \| `cancelled` \| `done` | Visit book. |
| `service_requests.status` | `open` \| `fulfilled` \| `cancelled` | Hold / order / enquiry. |
| `escalation_notify.stage` | `notified` \| `desk_only` \| `failed` | Staff handoff delivery. |
| `notify_sends` | dest + kind + call, channel | Send ledger + instance cap. **MISSING on ALCR** until 24c apply. Staging has it. |
| `whatsapp_messages.status` | Meta/SautiKit receipt | Platform WABA only. |
| `billing_enforcement` | `off` \| `soft` \| `hard` | Wallet mode. |
| `handoff_mode` | `callback` \| `live_transfer` | Preference. **Not** proof Dial works. |

Inbox triage columns (`inbox_read_at`, snooze, mute, pin) exist. Product is cutting snooze/unread from the UI. Do not rebuild them as a second attention channel.

---

## 2. Voice

### How a call works

```text
Caller → SautiKit DID
  POST /voice/incoming  → Stream XML (connect=true, 16 kHz)
  wss /ws/media         → Soniox STT → Brain state → Gemini → tools → Soniox TTS
  POST /voice/events    → duration, recording, wallet charge, hangup lead SMS, transcript review
```

Tenant resolve is by **DID** (`tenants.sautikit_virtual_number`). Profile load: `getTenantProfile`. Prompt: CONTEXT HEADER + LIVE GROUND TRUTH + compiled `llm_system_prompt` + CONVERSATION_RULES + playbook (retail / home_services only).

**Inbound:** the only live telephony product.  
**Outbound:** no shop “click to call from Scalers”. Desk **Call** is `tel:` on the owner’s phone. Live-transfer outbound is specified, gated, and **blocked** as a product (below).  
**Voice brain:** per-call Map in `server.js` (`callBrainStates`). Dies at hangup. Across calls: returning-caller card only.

Tools that write the business: `save_caller_info`, `create_service_request`, `create_appointment` / `update_appointment`, `escalate`, `end_call`. TRANSFER is a Brain action that `liveTransferReady` almost always denies.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `VOICE_LIVE_TRANSFER` | **off** | Global executor. Tenant `handoff_mode=live_transfer` cannot override. Desk “Rings {name}” only if this is on. |
| `VOICE_LIVE_TRANSFER_IGNORE_HOURS` | off | Lab: Dial when closed. |
| `VOICE_LIVE_TRANSFER_BETA_OUTBOUND` | off | Lab: allow `POST /v1/calls` while `billing_enforcement=off`. Staging only. |
| `WALLET_RATE_KES_PER_MINUTE` | 0 | Inbound debit. |
| `WALLET_TRANSFER_RATE_KES_PER_MINUTE` | 4 | Outbound transfer debit (SautiKit cost 3). Unused while Dial is off. |
| `POST_CALL_GEMINI_REVIEW` | on | Hangup `owner_review`. |
| `VOICE_LLM_STREAM` | (env) | Stream Gemini into TTS. |

`GET /healthz` exposes `liveTransfer.executor`. Treat that as an ops bit, not a Desk badge.

### What exists vs what Desk may claim

Code for cold Dial is real: `queuePendingLiveTransfer`, `/voice/transfer`, `saveTransferAttempt`, billing helpers. ADR-0004 executor is **superseded**: StreamStopped rides `events_url` (cannot return Dial); Redirect after `<Stream connect="true"/>` did not run on staging (`HD_ae71b5349f5e`, `HD_4f14d4d55244`). Next lab is **conference + REST outbound**, not another WS-close.

Desk Train copy today (`TenantForm.tsx`): if the executor env is **off**, live_transfer shows “Messages {name}.” If someone turns `VOICE_LIVE_TRANSFER=on` on the **desk** host without a working conference, the same panel will say **“Rings {name} during open hours.”** That is the remaining lie. Voice host and Vercel env must stay **off** until a human actually rings.

Call detail already stamps `live_connect` when escalate runs and transfer did not (`Notify only (live connect unavailable)`). Keep that.

### Desk must never claim

- Online / presence-as-availability. Line chip is **Line live** / **Number pending** / **Needs training** (`lineStatus.ts`). Home `LivePing` is bulletin **Updates**, not the receptionist being on a call.
- Rings {name}, “transferred you”, “connect live” as a shipped outcome.
- PSTN / conference / queue / press-0 as a package feature.
- Softphone / click-to-dial from Scalers.
- “Escalation sent” without `escalation_notify.stage=notified`, a live channel, and a `notify_sends` row. Missing ledger → **failed**.
- “Replied” or “WhatsApp delivered” from a wa.me click.

---

## 3. Business intelligence / brain

Two different “brains.” Do not collapse them.

| Brain | Job | Status |
| --- | --- | --- |
| **Company Brain** | Scalers Inc operating doc | `docs/company/COMPANY_BRAIN.md` |
| **Voice Brain** | Per-call receptionist | `src/conversation/*` + compile |

### What exists (repo)

Phase 0–2 of [`../BUSINESS_INTELLIGENCE_ROADMAP.md`](../BUSINESS_INTELLIGENCE_ROADMAP.md) largely landed:

- `tenants.vertical`, `handoff_mode`, `business_locations`, `business_policies`
- `contacts` + `service_requests` + `appointments`
- Retail + home-services playbooks (`src/conversation/playbooks/`)
- Tools that write those tables
- Desk Inbox Visits / Holds, Contacts, Train + 4-step onboarding
- `calls.resolution` + `primary_intent` + hangup `owner_review` `{want, done, mood, next, reason}`
- Returning-caller card (ADR-0005)
- Evalite: `npm run eval:brain`

### What does not exist

- Hospitality pack
- Learning-loop queue (FAQ suggestions only)
- Resolved-rate dashboard as a product surface
- `knowledge_chunks` / embeddings / mid-call RAG
- Prompt / agent snapshot on the call row ([`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md) — **not started**)
- Campaigns, auto-reply, Instagram Graph
- A second “Company OS” intelligence store besides tenants + thin CRM + call rows

Roadmap §2.2 still says contacts/CRM “not implemented.” **That line is stale.** Trust the progress table in §11 of the same file and the code.

### How it should feed Desk + future replies

**Now (wedge):** Desk reads the same rows Voice writes. Needs you is derived. Hangup card lives on the **record**, not the list preview. Whose-turn (Product, ACCEPT queued) must be **language on those rows**, not a new column.

**Ladder step 2 (memory deepening):** contact + timeline **truth** from `contacts`, `calls`, `service_requests`, `appointments`, `notify_sends`. Platform job is a stable **read contract** (and indexes if the strip is slow), not a new status enum.

**Ladder steps 3–4 (assisted → auto-assist):** drafts grounded in that file. Owner taps send. Auto-reply only where policy + confidence allow. Voice already auto-assists **on the phone**. Do not auto-send WhatsApp from the same Brain until delivery vocab is locked and the send stack is real.

**Ladder steps 5–6:** same file, more channels and campaigns. One brain. Not a second inbox product.

Intelligence-before-automation is product law. Platform does not stand up a campaign sender because the CRM tables exist.

---

## 4. Channels

### WhatsApp (three products, one word)

| Path | Who | Mechanism | Honesty label |
| --- | --- | --- | --- |
| **A. Staff alert** | Owner / permissioned teammate | SautiKit Cloud, Scalers WABA `+254709221536`, utility template (`scalers_staff_alert` Active; kind names pending env) | Sent only if dispatch accepts. Ledger `notify_sends`. |
| **B. Platform inbound** | Anyone who texts Scalers | `POST /whatsapp/events` → persist thread → mark read → canned 24h ack | Not a desk action. Does not confirm visits. |
| **C. Owner → caller** | Owner’s personal WhatsApp | `https://wa.me/{digits}` | **Opened / followed up** (#358). Not delivered. |

There is **no** shop Embedded Signup, no per-tenant WABA, no caller WhatsApp templates, no desk composer, no Chatwoot.

Phase 0 dual-use (live until a second DID): voice on `+254709221536` is **Done and Dusted**; Cloud identity on the same E.164 is **Scalers**. Inbound must route on `phone_number_id` `1237105982825100`, never `resolveTenantId(DID)`. Phase 2 (new Kenya DID, then point Scalers tenant at 0709) is Ops + Platform. Do not DELETE the SautiKit number. Do not enable Calling.

Delivery statuses already parse and persist (`persistWhatsAppStatus`). Desk does not show Meta ticks. Product + Critic lock words **before** Platform surfaces them. Until then, vocab-only.

### Instagram

`social_handles` kind `instagram` (and facebook/tiktok/…). Compile/ingest may mention the handle. **No** IG inbox, webhook, or send. Expansion ladder step 5.

### Notify (staff + caller SMS)

Ladder: TextSMS.co.ke → SautiKit WhatsApp → Resend → desk note. One success per dest + kind + call. Escalate: one teammate, no extra owner SMS. Contract: [`../CALL_MESSAGE_CONTRACT.md`](../CALL_MESSAGE_CONTRACT.md).

Known payload gap (Voice, not a new channel): mid-call lead SMS fires on `save_caller_info` before hangup `owner_review`. Visit/hold marks `whatsapp_sent` so hangup does not double the lead. [`../CALL_MESSAGE_GAP.md`](../CALL_MESSAGE_GAP.md).

Desk Ping (`pingTeammateAction` → `POST /internal/desk/escalate`) reuses the same notify path and the same `formatEscalationDelivery` honesty.

---

## 5. Wallet / billing (current truth)

One prepaid **KES** wallet. AI is inside the minute rate. Dual telecom-KES + AI-USD columns are legacy cache, not the product.

| Item | Truth |
| --- | --- |
| Charge | RPC `charge_call_to_wallet`, idempotent per `call_id`. Voice calls it on completed inbound. |
| Inbound rate | **KES 0 / min** (SautiKit inbound free). |
| Outbound transfer | **KES 4 / min** answered on a **second** `calls` row. Not originated in production. |
| Beta | `billing_enforcement=off` (default). Meter only. No charge. No outbound PSTN. |
| Soft / hard | Ops graduates on Admin → Wallets. Hard inbound block **not** shipped. |
| Line rental | Lazy `apply_line_rental` on Wallet page. Grace then `suspend_line_for_nonpayment`. |
| Alerts | Low / empty via notify (`billed_to=platform`). |
| On-demand | Owner opt-in. Same toggle for SMS past included. |
| SMS | Included 200 segments. Not a KES debit. Wallet/outage SMS are platform-paid. |
| Top-up | `WALLET_TOPUP_ENABLED` + M-Pesa/Paystack **stub**. Desk says online top-up is not enabled. Ops credit is the live path. |
| Packages | Reserved columns. No SKU picker. Company Brain pricing is **deferred** until the ops wedge is green. |

Always separate in copy (when Growth unlocks): (1) Scalers subscription, (2) carrier/voice, (3) Meta/BSP WhatsApp fees. Never hide Meta fees inside “unlimited messaging.”

---

## 6. Platform surface (contracts only)

Voice-facing `src/db.js` (do not break names): `upsertCall`, `saveCallerInfo`, `saveEscalation`, `saveTransferAttempt`, `persistOutboundTransferLeg`, `appendTranscript`, `attachRecording`, `getCall`, `getTenantProfile`, `getCallerMemory`, `markWhatsappSent`, `markEscalationSent`, `setCallResolution`, `chargeCallToWallet`, `createServiceRequest`, `createAppointment`, `updateAppointment`, `upsertContact`, `insertNotifySend`, `consumeSmsUnits`, `persistPlatformWhatsApp*`.

SQL apply order: [`../supabase/README.md`](../supabase/README.md). Notify objects: [`NOTIFY_SQL_CATALOG.md`](./NOTIFY_SQL_CATALOG.md). **P2 probe 2026-09-20:** ALCR missing `notify_sends` / WhatsApp thread tables / SMS allowance columns. Staging has them. Contacts / appointments / `notify_channels` / wallet columns are on both. `business_locations` / `business_policies` missing on both (note only). Never apply `foundation_bootstrap.sql` to ALCR. Other production SQL tiers stay unverified.

---

## 7. Incorporation order (ladder, not a rewrite)

Company Brain §7. Do not reorder without Product + founder.

```text
1 Honest desk wedge     Product  (#364 merged → whose-turn → verb cut → contact strip)
2 Business memory       Product+Critic vocab, then Platform read/send-truth
3 Assisted replies      Desk drafts; Platform send only after vocab + real channel
4 Trusted auto-assist   Brain policy; same send honesty
5 More channels         Instagram into the same brain
6 Campaigns             Growth + Platform send plumbing
```

### After #364 smoke (Release GO) — Platform does **not** jump to 3–6

| # | Job | Lane | Depends on | Why this and not the ocean |
| --- | --- | --- | --- | --- |
| P0 | Stay out of whose-turn / verb cut / contact strip | Product | #364 GO | No new `lead_status`. No Platform PR unless a read helper is requested. |
| P1 | **Lock delivery vocab** (opened / followed up / sent / delivered / failed) | Product + Critic | Wedge still in flight is OK (notes track) | Desk already has wa.me write-back and staff notify. Words first. |
| P2 | Production SQL catalog + fail-open honesty | Platform | Probe 2026-09-20 | Catalog: [`NOTIFY_SQL_CATALOG.md`](./NOTIFY_SQL_CATALOG.md). Runtime refuses **sent** without ledger/RPC. **SQL still to apply on ALCR (ops):** `notify_send_ledger.sql`, `sms_allowance.sql`, `whatsapp_threads.sql` (24c, 24d, 24f). 24e not probed. |
| P3 | Read model for existing truth: `notify_sends` + `whatsapp_messages.status` + `escalation_notify` | Platform → Desk | P1 vocab + P2 apply | Surface ticks. Do not add `delivery_status` on `calls`. |
| P4 | Optional: persist `owner_notify_body` (or ledger body already written) so SMS audits stop reconstructing | Voice + Platform | P2 | CALL_MESSAGE_GAP. Small additive column or use `notify_sends`. |
| P5 | Hangup-wait for owner **lead** SMS | Voice | P4 optional | Largest payload fix. Not a new channel. |
| P6 | Contact activity strip data: reuse `getCallerMemory` + calls/requests/appointments. Add a list helper only if Desk asks | Platform | Product strip spec (after whose-turn) | Memory deepening. Same tables. |
| P7 | Phase 2 DID split (second Kenya number; Scalers voice vs shop) | Ops + Platform | Spare DID bought | Unblocks honest Scalers WA identity. Not an inbox. |
| P8 | Assisted-reply send (owner tap) | Platform | Ladder 1–2 green + P1 + caller channel decision | Default stays wa.me or caller SMS. Meta caller templates are a **new** approval batch. |
| P9 | Conference live-transfer **lab** | Voice | Staging flag only | Not a product. Keep `VOICE_LIVE_TRANSFER=off` on desk and prod. |
| P10 | M-Pesa STK / package SKUs / campaigns | Ops + Growth + Platform | #364 GO **and** whose-turn on the ops queue | Company Brain unlock. Not this month’s Platform default. |

### Explicit non-jobs

- Do not enable `VOICE_LIVE_TRANSFER` to “complete” the BI roadmap handoff row.
- Do not install Baileys, Chatwoot, or a second WhatsApp list on `/calls`.
- Do not add Instagram Messaging.
- Do not add `delivery_ladder`, `thread_state`, or “whose_turn” columns.
- Do not extract `server.js` into `TARGET_MODULE_LAYOUT` as a prerequisite for the ladder.
- Do not migrate host mid-wedge.

---

## 8. Pointers

| Doc | Use |
| --- | --- |
| [`../company/COMPANY_BRAIN.md`](../company/COMPANY_BRAIN.md) | North star, wedge, ladder, roster |
| [`../BUSINESS_INTELLIGENCE_ROADMAP.md`](../BUSINESS_INTELLIGENCE_ROADMAP.md) | Voice Brain destination (stale “no CRM” in §2; trust §11 + this map) |
| [`../CALL_MESSAGE_CONTRACT.md`](../CALL_MESSAGE_CONTRACT.md) / [`../CALL_MESSAGE_GAP.md`](../CALL_MESSAGE_GAP.md) | Who gets what after a call |
| [`../ESCALATION.md`](../ESCALATION.md) | Async handoff (the shipped product) |
| [`../LIVE_TRANSFER.md`](../LIVE_TRANSFER.md) / ADR-0004 | Blocked Dial; conference next |
| [`../WHATSAPP_TEMPLATES.md`](../WHATSAPP_TEMPLATES.md) / [`../specs/whatsapp-two-way.md`](../specs/whatsapp-two-way.md) | Staff templates + dual-use DID |
| [`../ONE_WALLET_BILLING.md`](../ONE_WALLET_BILLING.md) / [`../BETA_WALLET_PROGRAM.md`](../BETA_WALLET_PROGRAM.md) | Prepaid truth |
| [`NOTIFY_SQL_CATALOG.md`](./NOTIFY_SQL_CATALOG.md) | ALCR vs staging notify SQL + apply checklist |
| [`../product/DELIVERY_VOCAB.md`](../product/DELIVERY_VOCAB.md) | Critic ladder: opened / followed_up / sent / delivered / failed |
| [`../agents/PLATFORM.md`](../agents/PLATFORM.md) | Lane owns |
| [`../architecture/CURRENT_STATE.md`](../architecture/CURRENT_STATE.md) | Aug 2026 baseline; this map is newer |

---

## 9. Change log

- **2026-09-20** — First map from `main` @ `2e6d58d` for Company Brain v0.2.1 Platform seating. Landed on `main` as #368.
- **2026-09-20 P2** — Live SQL probe: ALCR missing notify ledger / WhatsApp threads / SMS allowance; staging has them. Runtime no longer claims **sent** when those objects are missing. Apply remains ops/SQL Editor.

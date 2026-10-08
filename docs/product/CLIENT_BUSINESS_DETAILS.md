# Client business details, methods, and onboarding

As-is map of what Scalers collects from a tenant owner, how those facts enter the system, how Settings organizes them, what the Business Assistant can do with them, and how signup plus onboarding seed a live line.

This is a facts document. It does not propose new fields. Source of truth for compile is Desk (`dashboard/src/lib/promptCompiler.ts`). Source of truth for live tools and playbooks is Voice/Brain (`src/conversation/`). Owners never edit `tenants.llm_system_prompt` in the UI.

Related: [`MVP_SHIP_AND_TEST.md`](./MVP_SHIP_AND_TEST.md), [`ESCALATION.md`](./ESCALATION.md), [`LIVE_TRANSFER.md`](./LIVE_TRANSFER.md), [`../agents/BRAIN.md`](../agents/BRAIN.md), [`../agents/DESK_UX.md`](../agents/DESK_UX.md).

---

## 1. How a client's facts become a live line

```text
Signup
  business name, work email, notify phone
  → tenant row + default prompt + DID assign (best effort)

Onboarding (4 steps)
  type, offers, hours/location, name/tone/handoff
  → seed catalog, FAQs, policies, hours grid, team catch-all, tools
  → compile llm_system_prompt
  → /home

Settings (Train)
  scoped saves of the same structured columns
  → recompile on every successful save

Live call
  compiled prompt
  + CONTEXT HEADER (Kenya time, identity, open/closed, bulletin, returning caller)
  + LIVE GROUND TRUTH (hours, catalog matches, policies)
  + Brain tools (hold, visit, escalate, hangup)
```

Live ground truth on the turn wins over a stale compiled prompt. After-hours / bulletin honesty is runtime, not a Settings rewrite.

---

## 2. What we collect

Grouped by owner job. Storage is almost always a column on `tenants`.

### Account (signup)

| Owner field | Stored as | Required |
| --- | --- | --- |
| Business name | `business_name` | Yes |
| Work email | Auth user email | Yes |
| Password | Auth | Yes, min 8 |
| Notification phone | `whatsapp_notification_number` (Kenya E.164) | Yes |

Signup does not collect hours, catalog, or tone. Those come from the wizard or Settings.

### Identity

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Assistant name | `agent_name` | Default `Receptionist`. Spoken as the person on the line. |
| Tone | `agent_tone` | `professional` or `warm`. Manner only. Does not turn Sheng on or off. Older chips `friendly` / `empathetic` / `localized` compile as `warm`. |
| Business name | `business_name` | Also collected at signup. |
| Spoken name | `spoken_name` | Optional TTS-friendly business name. Max 40. |
| Short invite | `greeting_invite` | Optional. Max 80. |
| Business type | `vertical` | Sold packs: Shop (`retail`), Home services (`home_services`). Legacy `hospitality` and `general` stay stored until the owner picks a pack. |
| Public contacts | `social_handles.channels[]` | Kind (`phone`, `whatsapp`, `website`, `instagram`, …), label, value. |

### Catalog (what we offer)

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Services | `services_catalog[]` | Name, price range, notes, out of scope. Limit 40. |
| Products (shops) | `product_catalog[]` | Name, price, category, stock (`yes` / `no` / `unknown`). Optional sku, unit, notes, aliases. Limit 500. |
| Notes (free text) | Folded into `services_offered` | Compiler string, not its own column. |
| Compiler text | `services_offered` | Built from services + products + social. Used by the prompt compiler and the onboarding gate. |

Home services leans on `services_catalog`. Retail leans on `product_catalog` after import; onboarding still seeds `services_catalog` from the prose line.

### Hours

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Per-day open / opens / closes | `hours_schedule.days.{mon..sun}` | `{open,close}` or closed (`null`). Timezone `Africa/Nairobi`. At least one open day on Settings save. |
| Compiler text | `business_hours` | Formatted from the grid. Onboarding gate requires this string. |

### Locations

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Label | `business_locations[].label` | First place is often `Main`. Max 8 places. |
| Area | `.address` | |
| Landmark | `.landmark` | |
| Directions | `.directions` | |
| Coverage / notes | `.coverage_notes` | Home services also has policy `coverage_areas[]`. |

The first place line also mirrors into `hours_schedule.location`.

### Policies

| Owner field | JSON key on `business_policies` | Notes |
| --- | --- | --- |
| Coverage (home services) | `coverage_areas` | String list. |
| Payment | `payment` | |
| Holds | `deposit` | Retail wording is holds. |
| Returns | `returns` | |
| Delivery | `delivery` | |
| Cancellation | `cancellation` | |
| Warranty | `warranty` | |
| Other | `other` | |
| What to say when unsure | `unknown_answer_fallback` | Own column. Seeded at onboarding. |

Empty policy fields stay unknown on the call. The assistant must not invent amounts or policy wording.

### FAQs

| Owner field | Stored as | Limits |
| --- | --- | --- |
| Question / answer pairs | `faqs[]` | 25 pairs. Question max 200. Answer max 400. |

### Team and notify

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Name, role, phone, email | `team_directory[]` | Limit 20. |
| Urgent / Follow-up / Ops | `.receives_escalation`, `.receives_inbox`, `.receives_ops` | Who gets which alert. |
| Live connect preference | `handoff_mode` | `callback` (default) or `live_transfer`. |
| Alert phone | `whatsapp_notification_number` | Signup + How we notify. |
| Alert email | `alert_email` | How we notify. |
| Channels | `notify_channels` | Booleans: `sms`, `whatsapp`, `email`, `caller_sms`, `missed_textback`. |

### Assistant controls

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Voice | `soniox_voice_id`, `soniox_voice_label` | Curated Soniox voices. |
| On a call | `after_hours_mode` | `serve` (Full assistant) or `message` (Message only). |
| Alert a teammate | `agent_tools.escalate` | Default on. |
| Hang up after goodbye | `agent_tools.end_call` | Default on. |
| How names are said | `tts_lexicon` | Max 24 match/say entries. Coach + optional Gemini scan. |

### Today's notes (Home, not Settings)

| Owner field | Stored as | Notes |
| --- | --- | --- |
| Update text | `daily_bulletin[].text` | Max 160. |
| Expiry / schedule | `.starts_at`, `.ends_at` | Today, tomorrow, manual, or schedule. |

Bulletin is live ground truth. Promo lines must not be volunteered off-topic.

### Not collected from the owner in product UI

DID assignment, wallet, Resend/DNS, API keys, env names, and raw prompt text stay in infra or compile. Language on the line is auto `en` / `sw` / `sheng` after the caller speaks. There is no owner language picker.

---

## 3. How we collect them

| Path | What the owner does | What we write |
| --- | --- | --- |
| **Signup** | Name, email, password, notify phone | Tenant + default prompt + notify phone. DID from pool if a number is free. |
| **Onboarding wizard** | Four steps of prose and choices | Same structured columns Settings later edits, plus a compiled prompt. |
| **Settings form** | One panel at a time | Scoped overwrite (`settingsSaveScope.ts`) then `compileReceptionistPrompt`. Hidden fields carry the rest of the snapshot so other panels do not wipe. |
| **Catalog paste** | Bulk services / products in Catalog | Parsed rows into `services_catalog` / `product_catalog`. |
| **Import (shop)** | Paste, CSV, or URL | `product_catalog`, optional `social_handles`. Retail import does not recompile the prompt. |
| **Import (other)** | Paste or URL | Review draft, then merge or replace services/FAQs plus optional hours, locations, policies, vertical, phone, business rename. Recompiles. |
| **How we notify** | Phone, email, channel switches | Notify columns only. No compile. |
| **Home Today's notes** | Short bulletin | `daily_bulletin` only. No compile. |
| **Pronunciation** | Coach + confirm | `tts_lexicon` (and scan queue columns). |
| **Calls → FAQ suggest** | Owner accepts a suggested pair | Appends `faqs`. |

Gemini extract (ingest) and Gemini compile are optional. If `GEMINI_API_KEY` is missing, ingest falls back to local extract and compile falls back to `compilePromptLocally`.

---

## 4. How Settings is organized

Route: `/settings`. Shell: `BusinessSettingsShell`. Nav: `SETTINGS_NAV` in `dashboard/src/lib/businessSettingsNav.ts`.

Phone opens the index (section list). Wide screens with the desk cookie open **Hours**. Appearance lives on the account menu, not here.

```text
Business
  Identity
  Hours
  Locations
  Policies

Knowledge
  Catalog
  Import
  FAQs

Assistant
  Voice          ← tools + after-hours + Soniox voice
  Pronunciation
  Test

People
  Team
  How we notify
```

| Nav label | URL | Form scope |
| --- | --- | --- |
| Identity | `?tab=train&panel=identity` | Name, spoken name, invite, tone, vertical, social |
| Hours | `?tab=train&panel=hours` | `hours_schedule` only |
| Locations | `?tab=train&panel=locations` | Places + location line |
| Policies | `?tab=train&panel=policies` | Policies + unknown fallback |
| Catalog | `?tab=catalog` | Services / products |
| Import | `?tab=import` | Retail catalog import or knowledge ingest |
| FAQs | `?tab=train&panel=faqs` | FAQ pairs |
| Voice | `?tab=train&panel=tools` | Voice pick, On a call, two tool switches |
| Pronunciation | `?tab=train&panel=pronunciation` | Lexicon |
| Test | `?tab=test` | Call the line. No profile write. |
| Team | `?tab=train&panel=team` | Directory + live connect |
| How we notify | `?tab=alerts` | Alert phone, email, channels |

Save is docked on the form. Each panel save recompiles `llm_system_prompt` except Alerts, Test, bulletin, and retail catalog apply.

---

## 5. Methods: what the assistant can do

"Methods" are two layers. Settings only exposes the second layer as owner switches.

### 5.1 Jobs the line can finish (runtime tools)

No per-job toggle in Settings. Vertical + On a call + validation decide whether a job can fire.

| Tool | Owner-facing job | Required to save | Shop | Home services | Hospitality / Other |
| --- | --- | --- | --- | --- | --- |
| `create_service_request` type `hold` | Hold an item for pickup | Name, catalogue item, when | Yes | No (not the shop playbook) | No. Message or escalate only. |
| `create_service_request` type `order` | Log an order | Name, catalogue item | Yes | No | No |
| `create_service_request` type `enquiry` / `callback` / `other` | Enquiry or callback | Item or notes | Yes | Callback when a visit cannot be booked | Message path |
| `create_appointment` | Book a visit | Service, name, when, location | No | Yes | No |
| `update_appointment` | Change or cancel a visit | Status and/or when / landmark / notes | No | Yes | No |
| `save_caller_info` | Remember name / reason | Name and/or reason | Yes | Yes | Yes |
| `escalate` | Alert a teammate | Real caller name + reason | Yes if switch on | Yes if switch on | Yes if switch on |
| `###ENDCALL###` | Hang up after goodbye | Clear goodbye | Yes if switch on | Yes if switch on | Yes if switch on |

Holds and orders must match the catalogue. Unlisted or garbled titles become an enquiry, not a clean hold. Spoken "booked" / "held" / "saved" only after the tool result.

Playbooks: `src/conversation/playbooks/retail.js` and `homeServices.js`. `hospitality` and `general` get no hold or visit pack.

### 5.2 Owner switches (Settings → Voice and Team)

| Control | Setting | Default | Effect |
| --- | --- | --- | --- |
| **On a call → Full assistant** | `after_hours_mode = serve` | Yes (onboarding seeds this) | Answer, book, change a visit. When closed, still answer FAQs and take actions (KEEP SERVING) unless the bulletin closes today. |
| **On a call → Message only** | `after_hours_mode = message` | No | Name + message. Appointments off. Service requests collapse to **callback** only. No visit day/time/place collection. Escalate still works if the switch is on. |
| **Alert a teammate** | `agent_tools.escalate` | On | Notify SMS → WhatsApp → email and write a desk note. Off: take a note, do not promise a notify. |
| **Hang up after goodbye** | `agent_tools.end_call` | On | May hang up after goodbye. Off: stay on the line. |
| **Live connect** (Team) | `handoff_mode = live_transfer` | Off (`callback`) | Preference only. Shipped path is async notify. Live Dial stays gated (`VOICE_LIVE_TRANSFER` + open hours + dialable team phone). See [`LIVE_TRANSFER.md`](./LIVE_TRANSFER.md). |

Team **Urgent** (`receives_escalation`) picks who the alert goes to. How we notify picks the channel. Escalate still needs a real caller name and a reason.

### 5.3 Capability matrix (runtime)

Built in `capabilitiesForProfile()` / `buildBrainCapabilities()` and tightened by `applyMessageOnlyCapabilities()`.

| Capability | Full assistant, open | Full assistant, closed | Message only |
| --- | --- | --- | --- |
| Answer hours, place, FAQ, price from file | Yes | Yes | Yes |
| Hold / order (shop, catalogue) | Yes | Yes (KEEP SERVING) | No (callback only) |
| Book / change visit (home services) | Yes | Hours gate still applies | No |
| Callback / enquiry | Yes | Yes | Callback only |
| Escalate | If switch on | If switch on | If switch on |
| Live Dial | If gates pass | No | No |
| Hang up | If switch on | If switch on | If switch on |

Brain will inject `create_appointment` / `create_service_request` when slots are complete and the model only speaks. Confirmation is the tool result, not the model promising the row.

---

## 6. Onboarding

### 6.1 Entry

1. `/signup` → `signupAction` writes auth metadata (`business_name`, `whatsapp_notification_number`).
2. DB trigger `handle_new_user_tenant` (or Desk `ensureTenantForUser`) creates the tenant, owner membership, default `llm_system_prompt`, and `sautikit_virtual_number = pending:{userId}`.
3. `assign_did_from_pool` runs at **signup**, not at wizard finish. Empty pool leaves `pending:`.
4. Session present → `/onboarding`. Email confirm required → stay on "Check your email".
5. Desk layout (`(desk)/layout.tsx`) sends the owner back to `/onboarding` while `tenantNeedsOnboarding` is true.

**Gate** (`dashboard/src/lib/onboarding.ts`): skip the wizard when `services_offered`, `business_hours`, and `agent_tone` are all set. If those are empty, the signup default prompt (markers like "describe what you offer" / "update this in Scalers") still forces the wizard.

Login of a finished tenant goes to `/home`, then the layout gate.

### 6.2 Wizard (4 steps)

UI: `dashboard/src/app/onboarding/OnboardingWizard.tsx`. Submit: `completeOnboardingAction`.

| Step | Title | Owner gives | Client check |
| --- | --- | --- | --- |
| 0 | Business type | Shop or Home services | A type (default Shop) |
| 1 | Products & pricing (shop) or Services & pricing | Free-text list | ≥ 12 characters |
| 2 | Hours & location | Hours/location prose; optional landmark and directions | Hours prose ≥ 8 characters |
| 3 | Tone & handoff | Assistant name (default Receptionist), tone (`warm` default), handoff (`callback` default) | Tone present |

The picker does not sell Hotel or Other. Invalid vertical on the server becomes `general`.

### 6.3 What finish writes

`buildRetailOnboardingSeed` (used for both packs) plus compile:

| Written | Source |
| --- | --- |
| `vertical`, `agent_name`, `agent_tone`, `handoff_mode` | Step 0 and 3 |
| `services_offered`, `services_catalog` | Parsed prose + pack defaults if parse is thin |
| `business_hours`, `hours_schedule` | Parsed hours prose; bare `9am-5pm` becomes Mon–Sat |
| `business_locations` | One `Main` row from landmark / hours text / directions |
| `faqs` | Pack starters; hours and location answers patched from the owner's prose |
| `business_policies`, `unknown_answer_fallback` | Pack starters |
| `team_directory` | Owner catch-all from signup notify phone / alert email, role "General queries" |
| `agent_tools` | `{ escalate: true, end_call: true }` |
| `after_hours_mode` | `serve` |
| `llm_system_prompt` | Gemini compile, or local if Gemini is down or the result still looks like the signup default |

Not written here: `product_catalog`, `social_handles`, `spoken_name`, `greeting_invite`, Soniox voice, wallet, a second DID assign.

Redirect: `/home`.

### 6.4 Pack seeds

**Shop**

- FAQs: hours, location, M-Pesa, hold, delivery, source a missing title.
- Policies: M-Pesa/cash, Nairobi same-day + countrywide, holds with name + pickup time, returns via the team.
- Unknown line: note it or log a hold/enquiry.

**Home services**

- FAQs: hours, we come to you, coverage, quote on site, book a visit, carpet/couch/mattress, same day, true emergency vs cleaning urgency.
- Default services if the list is thin: home cleaning, carpet/upholstery/mattress, and the rest of `homeDefaultServices()`.
- Policies: pay after the visit, we come to you, deposit/cancel/warranty, burst/flood/fire/gas/shock to the team.
- Unknown line: note it or book a visit once the basics are in.

Owner must replace seed names with the real menu. Empty Train after this is a knowledge miss, not a Brain miss.

### 6.5 After onboarding (same fields, richer UI)

| Wizard input | Settings home |
| --- | --- |
| Business type | Identity |
| Assistant name, tone | Identity |
| Services / products prose | Catalog (and later Import for shop SKUs) |
| Hours prose | Hours grid |
| Landmark, directions | Locations |
| Seeded FAQs | FAQs |
| Seeded policies + unknown line | Policies |
| Handoff | Team → Live connect |
| Seeded team catch-all | Team |
| Seeded tools + full assistant | Voice |
| Signup notify phone | How we notify |

MVP readiness after this still wants a real DID (not `pending:`), prompt ≥ 80 chars, hours + landmark, FAQs, unknown line, a notify path, and the catch-all teammate. Shop should import the product catalogue soon after. See [`MVP_SHIP_AND_TEST.md`](./MVP_SHIP_AND_TEST.md) config gate.

---

## 7. Compile inputs

`compileReceptionistPrompt` takes structured fields, not raw Settings HTML:

`businessName`, `servicesOffered`, `businessHours`, `agentTone`, `agentName`, `teamDirectory`, `faqs`, `unknownAnswerFallback`, `escalateEnabled`, `vertical`, `handoffMode`, `locationsText`, `policiesText`, `productsText`, `socialText`.

Vertical job text in the compiled prompt:

- **retail:** holds via `create_service_request`; do not claim a visit booked.
- **home_services:** visits via `create_appointment` / `update_appointment`; cleaning urgency is a visit, not escalate.
- **hospitality / general:** saved message or escalate only.

---

## 8. File map

| Area | Path |
| --- | --- |
| Settings nav | `dashboard/src/lib/businessSettingsNav.ts` |
| Settings form | `dashboard/src/components/TenantForm.tsx` |
| Scoped save + compile | `dashboard/src/app/(desk)/settings/actions.ts`, `settingsSaveScope.ts` |
| Ingest / catalog import | `ingestActions.ts`, `catalogActions.ts` |
| Alerts / bulletin | `alertsActions.ts`, `bulletinActions.ts` |
| Signup | `dashboard/src/app/signup/` |
| Onboarding | `dashboard/src/app/onboarding/`, `lib/onboarding.ts`, `retailOnboardingPack.ts`, `homeServicesOnboardingPack.ts` |
| Vertical / hours / tools / handoff | `lib/vertical.ts`, `hoursSchedule.ts`, `agentTools.ts`, `afterHours.ts`, `handoffMode.ts` |
| Prompt compile | `dashboard/src/lib/promptCompiler.ts` |
| Live tools + playbooks | `src/conversation/toolExecution.js`, `playbooks/`, `messageOnly.js`, `agentTools.js` |
| Tenant provision + DID | `dashboard/src/lib/tenant.ts`, `docs/supabase/multi_tenant_onboarding.sql`, `did_number_pool.sql` |

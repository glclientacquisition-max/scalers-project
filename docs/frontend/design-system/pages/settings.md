# Settings `/settings`

**Job:** Teach and configure the business and the assistant.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) Components. Settings primitives live in `settingsUi.tsx`.

## IA

`/settings` is the Settings tab. Bare `/settings` is the hub: destination index. Sign out stays inside the account menu. Each settings row is one destination. Same `?tab=` / `?panel=` routes. Appearance is the theme cluster in the account menu. Opening it does not open Settings and does not wait on the Settings load. It is not a settings row. Old `?tab=appearance` redirects to the hub. No new field screens.

```text
Business       Identity · Hours · Locations · Policies
Knowledge      Catalog · Import · FAQs
Assistant      Voice · Pronunciation · Test
People         Team · How we notify
```

One header per group. Import sits directly under Catalog. Team is the first People row. How we notify is not the parent of Team. Locations and Policies keep those labels. FAQs stay in Knowledge. Updates stay on Home.

Phone: dense index rows. Tap a row to drill in. Nested panels hide the bottom tab bar (`data-desk-nested`). The Settings hub keeps tabs. `DeskBack` icon, aria-label Settings (`lg:hidden`). The `md+` rail stays packed (`md:w-max md:max-w-[13.5rem] shrink-0`, group headers + tabs) beside a fluid panel (`min-w-0 flex-1`). `SettingsSegmented` uses Inbox rate cards (`deskRateCardClass`). No `max-w-xl` or `max-w-5xl` dead zone. Headers are not links. Active rail tab uses a left `accent` bar and `text-accent-deep`, not a filled pill.

Sticky **Save** on Catalog and Train panels (except Pronunciation), top-right of the panel header (`TenantSettingsSaveButton` label is **Save**, not “Save and train”). After a successful compile the toast is `Saved · training line` (How we notify Save stays `Saved` only — no compile). How we notify, Import, and Test use the same menu without a second compile save. How we notify Save is the panel primary. Test has one filled control: Call when the line is live, otherwise **Hear greeting**.

Bare `/settings` is the phone index. md+ `/settings` with no tab redirects to Hours (`?tab=train&panel=hours`) before a form renders. `?tab=train` still opens Identity. Test line still opens Test. `?tab=updates`, `?tab=today`, and `?tab=appearance` open the hub, then a wide screen follows the Hours redirect. Updates stay on Home. Appearance stays on the account menu. `?tab=alerts` is How we notify (route id stays `alerts`). Hash `#train` is not routed. Sticky chrome is **Save**; compile still trains the line — honesty is the toast `Saved · training line`, not a Train verb on the button.

## Chrome

Short in-page title Settings plus compact workspace name on the hub. The top strip is initials only. Hub rail status: Identity shows business name, else tone (Warm / Professional) — never the Voice label string; Voice shows the voice label / catalog description (`settingsOptionStatus`). Line live / Number pending stays on Test. Import, Catalog, and the other panels do not repeat it. The account-menu theme cluster does not repeat it. Do not use `deskListTitleClass` on the hub. Sign out is the last account-menu item (`POST /api/logout` after confirm). No giant Business Profile `h1`. Sub-panels keep `DeskBack` in the title row (`DeskRecordLead`, `lg:hidden`). Hours, Pronunciation, and the other panels share that lead. Back never owns its own row. **Save** stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`), except Pronunciation (header note **Saves live - no sticky Save**). The desk nav label is Settings. Path stays `/settings`. Import Knowledge and Import Catalog are the settings import titles. Import Contacts is `/contacts/import`.

Phone index: full-width grouped destination rows (`min-h-12`, label + chevron). lg+ sidebar: group headers + tabs, no chevron. Section titles are non-clickable (`uppercase tracking-wide text-gray-500`). Hover, active, and the canonical focus ring.

Panel titles use `settingsPanelHeadingClass` (`text-xl font-semibold`). Identity, Hours, Policies, Voice, and How we notify use grouped settings rows (`SettingsGroup` / `SettingsRow`: label left, control right). Booleans are a native checkbox switch (`ToolSwitch`, 44px hit, on-state `bg-accent-fill`). Two or three-option enums use `SettingsSegmented` rate cards (`deskRateCardClass`, same as Inbox and Contacts chips). Account-menu Appearance is the three theme cards, not that strip. Four-plus enums use `SettingsSelect` (wraps `DeskSelect`; open list portals under `body` inside `.desk-theme` so dark tokens resolve). Catalog, FAQs, Team, Locations, and Public contacts stay tables on `md+`/`lg+`. Phone stacks those records.

Primitives in `settingsUi.tsx` define hover, focus, and active. Do not invent a `Button.tsx`.

Density stays 8. Fill the canvas. Do not double page padding or import landing-scale type, glass, or a generic settings card stack. Do not add Billing or Security sections. Appearance stays on the account menu. It is this browser only.

## Panels

Inside each destination, group by owner job. Placeholders are examples, not instructions. No `e.g.` prefixes.

| Screen | Old control | New control |
| --- | --- | --- |
| Identity | Label-above inputs; tone and type chip rows | Grouped rows. Name fields. Tone select: Professional or Warm. Type select: Shop or Home services. Contacts table `md+`, stacked phone |
| How we notify | Form grid plus bordered toggle cards | Grouped Contact / Channels / Callers rows. Channel and caller flags are switches. Save filled |
| Catalog | Services and products tables `md+`, stacked phone | Unchanged tables. Add / paste stay ghost. Bulk apply filled |
| Hours | Open/Closed chip per day; after-hours chips | Day grid with open switches. Open and close times only |
| Locations | Places table `lg+`, stacked phone | Unchanged dense table. Add place ghost |
| Policies | Two-column textarea grid | Grouped Rules stacks. When unsure stack |
| Team | Handoff chips. Notify chips | Live connect switch when transfer can run (Team only — handoff off Voice, #514). People table `lg+` with **Role** column. Status: Rings {name} during open hours. |
| Voice | Voice chips. Tool switches. Hear sample bordered | Voice select. On a call: Message only or Full assistant, both selectable. Tool switches. Hear sample ghost. |
| Pronunciation | Coach with duplicate heading | Coach. Embedded heading is sr-only. Studio modes use underline tabs. No sticky Save — header **Saves live - no sticky Save** |
| Updates | Duration chips. Live cards | Duration segmented. Live grouped list. Post update filled. Clear ghost |
| Import | Radio cards. Native checkboxes | Paste / Website segmented. Include flags are switches. Scan / Add filled |
| Test | Generate preview filled plus large tel control | One filled control: Call when live, else **Hear greeting**. The other is ghost |
| Appearance | Account menu, not a Settings row | System / Light / Dark cluster. Label **This device**. `localStorage["scalers-desk-theme"]`. No Settings fetch |
| Sign out | Ghost, instant POST | Ghost until confirm. **Sign out?** then filled **Sign out** / ghost **Stay**. POST `/api/logout` only after confirm |

Do not invent fields. Do not change compile keys. How we notify persists `whatsapp_notification_number`, `alert_email`, and `notify_channels` without recompiling the assistant prompt.

## Control inventory

Scope: **this device** (browser only), **whole business** (tenant row, every owner), **assistant on calls** (after sticky **Save** compile — toast `Saved · training line` — or a live panel write that the compiler already reads).

One filled `#005CCC` per viewport. Booleans are `ToolSwitch`. Two or three exclusive options are `SettingsSegmented` rate cards. Four-plus exclusive are `SettingsSelect` (`DeskSelect` portal + `.desk-theme`). Destructive and session actions stay ghost until confirm.

### Identity (`?tab=train&panel=identity`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Assistant name | input | `agent_name` | Assistant on calls |
| Tone | select (4) | `agent_tone` | Assistant on calls |
| Business name | input | `business_name` | Whole business + assistant on calls |
| Business type | select (4) | `vertical` | Whole business + assistant on calls |
| Public contacts type / label / handle | table + selects + inputs | `social_handles` | Whole business + assistant on calls |
| Add phone / WhatsApp / social | ghost | appends a contact row | Whole business after Save |
| Remove contact | icon ghost | drops a contact row | Whole business after Save |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Hours (`?tab=train&panel=hours`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Day open | switch × 7 | `hours_schedule` | Assistant on calls |
| Opens / Closes | time input | `hours_schedule` | Assistant on calls |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Locations (`?tab=train&panel=locations`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Label / area / landmark / directions / coverage | table + input + textarea `rows={2}` | `business_locations`, `location_notes` | Assistant on calls |
| Add place | ghost | appends a place | Whole business after Save |
| Remove place | icon ghost | drops a place | Whole business after Save |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Policies (`?tab=train&panel=policies`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Payment, Holds, Returns, Delivery, Cancellation, Warranty, Other | textarea `rows={2}` | `business_policies` | Assistant on calls |
| When unsure / What to say | textarea `rows={2}` | `unknown_answer_fallback` | Assistant on calls |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Voice (`?tab=train&panel=tools`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Voice | select (4+) | `soniox_voice_id` | Assistant on calls |
| Voice label | input | `soniox_voice_label` | Whole business (desk label) |
| Hear sample | ghost | preview blob only | This device |
| On a call | segmented. Message only or Full assistant. Both can be selected. Message only takes a name and a message. Full assistant answers, books, and changes a visit. Selecting Full assistant does not force message only | `after_hours_mode` (`message` or `serve`) | Assistant on calls |
| Alert a teammate | switch | `tool_escalate` | Assistant on calls |
| Hang up after goodbye | switch | `tool_end_call` | Assistant on calls |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Pronunciation (`?tab=train&panel=pronunciation`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Practice / Library / Fix | segmented underline | studio tab only | This device |
| Header note | text | none | **Saves live - no sticky Save** (no `TenantSettingsSaveButton` on this panel) |
| Record and train | filled | `tts_lexicon` | Assistant on calls |
| Save spelling | ghost | `tts_lexicon` | Assistant on calls |
| Scan | muted text under the review list | suggestion queue | This device until Practice |
| AI listen | filled. Opens on Last 10. Last 20 and Last 50 confirm | review queue | This device until Use this |
| Use this | filled, label-sized | `tts_lexicon` | Assistant on calls |

### Updates

Home only. `DailyBulletinPanel` is not a Settings destination. Old `?tab=updates` links open the hub.

### Test (`?tab=test`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Hear greeting | filled if number pending, else ghost | `/api/pronunciation/preview` | This device |
| Call {DID} | filled if line live | `tel:` | This device + live line |

### FAQs (`?tab=train&panel=faqs`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Common questions | ghost shortcuts | seed `faqs` rows | Whole business after Save |
| Question / Answer | table + input + textarea `rows={2}` | `faqs` | Assistant on calls |
| Add FAQ | ghost | appends a row | Whole business after Save |
| Remove FAQ | icon ghost | drops a row | Whole business after Save |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Catalog (`?tab=catalog`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Service / product fields | table + inputs | `services_catalog`, `product_catalog` | Assistant on calls |
| Add service / **Add 3 blank rows** / Paste list / Add place-style ghosts | ghost | local rows | Whole business after Save |
| Add to services / Add to products | filled (bulk apply) | catalog arrays | Whole business after Save |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Import (`?tab=import`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Paste / Website (knowledge) | segmented (2) | source mode | This device |
| CSV / Paste / Website (products) | segmented (3) | source mode | This device |
| Text / URL | textarea `rows={2}` / input | extract payload | This device until Add |
| Scan | filled, docked | draft | This device |
| Knowledge include switches | switch, start off | apply flags | Whole business on Add |
| Row keep switches | switch | selected rows | Whole business on Add |
| Keep or replace | segmented (2) | `merge_mode` | Whole business on Add |
| Add selected / Add to catalogue | filled | checked sections / catalogue | Whole business + assistant on calls |
| Start over | ghost | clears draft | This device |

### How we notify (`?tab=alerts`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Alert phone | input | `whatsapp_notification_number` | Whole business (owner notify). Not prompt compile |
| Email | input | `alert_email` | Whole business (owner notify). Not prompt compile |
| SMS / WhatsApp / Email channels | switch | `notify_channels` | Whole business (owner notify). Not prompt compile |
| Text customers / Text back missed calls | switch | `notify_channels.caller_sms`, `missed_textback` | Whole business + caller SMS |
| Save | filled sticky | alerts action only | Whole business |

### Team (`?tab=train&panel=team`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Live connect | switch, when transfer can run or is already on (Team only; handoff UI off Voice, #514) | `handoff_mode` | Assistant on calls |
| Team phone | text | none | Rings {name} during open hours. or Add a team phone. |
| Name / **Role** / Phone / Email | table + inputs | `team_directory` | Whole business + assistant on calls |
| Urgent / Follow-up / Ops | switch | teammate notify flags (`receives_escalation` / `inbox` / `ops`) | Whole business |
| Channels note | text | none | Channels follow How we notify. Not a channel pick |
| Add person | ghost | appends a row | Whole business after Save |
| Remove person | icon ghost | drops a row | Whole business after Save |
| Save | filled sticky | compile; toast `Saved · training line` | Assistant on calls |

### Appearance (account menu)

Opening Appearance stays on the current desk page. It does not navigate to `/settings` and does not wait on tenant, catalog, or voice data.

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| This device (System / Light / Dark) | theme cards (3) | `localStorage["scalers-desk-theme"]` + `html[data-theme]`. Never tenant / Brain | This device |

Pre-paint script in `app/layout.tsx` reads the same key so the choice survives reload on that browser.

### Sign out (account menu, last)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Sign out (idle) | menu row, warn text | none | This session, after confirm |
| Sign out? | confirm cluster | none until submit | This session |
| Sign out (confirm) | filled | `POST /api/logout` (clears session cookies, Supabase sign-out) | This device session |
| Stay | ghost | dismisses confirm | This device |

## Language

Owner-facing: assistant, train, line. Sticky button is **Save**; toast after compile is `Saved · training line`. Not “Save and train” as the only chrome story. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team. Not Handles on Team (column is **Role**). Test primary when pending is **Hear greeting**, not Generate preview. Stark destination labels: Identity, Hours, Voice, Pronunciation, Catalog.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Invent a second layout for the same panels

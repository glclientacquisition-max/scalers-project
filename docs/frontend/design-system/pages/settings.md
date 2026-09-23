# Profile `/settings`

**Job:** Account hub. Teach and configure the assistant. Sign out.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) Components. Settings primitives live in `settingsUi.tsx`.

## IA

`/settings` is the Profile tab. Bare `/settings` is the account hub: destination index plus muted Sign out. Each settings row is one destination. Same `?tab=` / `?panel=` routes. Appearance is `?tab=appearance`. No new field screens.

```text
Business       Identity · Hours · Locations · Policies
Assistant      Voice · Pronunciation · Updates · Test
Knowledge      FAQs · Catalog · Import
Alerts         Alerts · Team
This device    Appearance · Sign out
```

Shipped panels that do not map 1:1 sit in the closest group. Locations and Policies stay under Business. Updates and Test stay under Assistant. Team stays under Alerts. Import stays under Knowledge.

Phone: dense index rows. Tap a row to drill in. Nested panels hide the bottom tab bar (`data-desk-nested`). The Profile hub keeps tabs. `DeskBack` icon, aria-label Profile (`lg:hidden`). The `md+` rail stays. lg+: nested inner rail (`lg:w-[13.5rem] shrink-0`, group headers + tabs) beside a fluid panel (`min-w-0 flex-1`). No `max-w-xl` or `max-w-5xl` dead zone. Headers are not links. Active rail tab uses a left `accent` bar and `text-accent-deep`, not a filled pill.

Sticky Save on Catalog and Train panels, top-right of the panel header. Updates, Alerts, Import, Test, and Appearance use the same menu without a second compile save. Alerts Save is the panel primary. Test has one filled control: Call when the line is live, otherwise Generate preview.

Bare `/settings` is the hub. lg+ hub shows Appearance in the panel. `?tab=updates` is Updates. `?tab=alerts` is Alerts. `?tab=appearance` is Appearance. Hash `#train` is not routed. `Train` is the verb on Save.

## Chrome

Short in-page title Profile plus compact workspace name and Line live / Number pending. Do not use `deskListTitleClass` on the hub. Muted Sign out on the hub header and in This device (`POST /api/logout`). No giant Business Profile `h1`. Sub-panels keep `DeskBack` plus a short title (Hours, Pronunciation). Save stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`). The desk nav label is Profile. Path stays `/settings`.

Phone index: full-width grouped destination rows (`min-h-12`, label + chevron). lg+ sidebar: group headers + tabs, no chevron. Section titles are non-clickable (`uppercase tracking-wide text-gray-500`). Hover, active, and the canonical focus ring.

Panel titles use `settingsPanelHeadingClass` (`text-xl font-semibold`). Identity, Hours, Policies, Voice, Alerts, and Appearance use grouped settings rows (`SettingsGroup` / `SettingsRow`: label left, control right). Booleans are a native checkbox switch (`ToolSwitch`, 44px hit, on-state `bg-accent-fill`). Two or three-option enums use `SettingsSegmented` underline tabs. Four-plus enums use `SettingsSelect`. Catalog, FAQs, Team, Locations, and Public contacts stay tables on `md+`/`lg+`. Phone stacks those records.

Primitives in `settingsUi.tsx` define hover, focus, and active. Do not invent a `Button.tsx`.

Density stays 8. Fill the canvas. Do not double page padding or import landing-scale type, glass, or a generic settings card stack. Do not add Billing or Security sections. Appearance is This device only.

## Panels

Inside each destination, group by owner job. Placeholders are examples, not instructions. No `e.g.` prefixes.

| Screen | Old control | New control |
| --- | --- | --- |
| Identity | Label-above inputs; tone and type chip rows | Grouped rows. Name fields. Tone select: Professional or Warm. Type select: Shop or Home services. Contacts table `md+`, stacked phone |
| Alerts | Form grid plus bordered toggle cards | Grouped Contact / Channels / Callers rows. Channel and caller flags are switches. Save filled |
| Catalog | Services and products tables `md+`, stacked phone | Unchanged tables. Add / paste stay ghost. Bulk apply filled |
| Hours | Open/Closed chip per day; after-hours chips | Day grid with open switches. When closed is segmented Keep helping / Message only |
| Locations | Places table `lg+`, stacked phone | Unchanged dense table. Add place ghost |
| Policies | Two-column textarea grid | Grouped Rules stacks. When unsure stack |
| Team | Handoff chips. Notify chips | Handoff segmented. Escalate / Inbox / Ops switches. People table `lg+` |
| Voice | Voice chips. Tool switches. Hear sample bordered | Voice select. Tool switches. Hear sample ghost. Handoff read-only |
| Pronunciation | Coach with duplicate heading | Coach. Embedded heading is sr-only. Studio modes use underline tabs |
| Updates | Duration chips. Live cards | Duration segmented. Live grouped list. Post update filled. Clear ghost |
| Import | Radio cards. Native checkboxes | Paste / Website segmented. Include flags are switches. Scan / Add filled |
| Test | Generate preview filled plus large tel control | One filled control: Call when live, else Generate preview. The other is ghost |
| Appearance | Three filled segment pills | System / Light / Dark underline tabs. Label **This device**. `localStorage["scalers-desk-theme"]` |
| Sign out | Ghost, instant POST | Ghost until confirm. **Sign out?** then filled **Sign out** / ghost **Stay**. POST `/api/logout` only after confirm |

Do not invent fields. Do not change compile keys. Alerts persist `whatsapp_notification_number`, `alert_email`, and `notify_channels` without recompiling the assistant prompt.

## Control inventory

Scope: **this device** (browser only), **whole business** (tenant row, every owner), **assistant on calls** (after Save and train, or a live panel write that the compiler already reads).

One filled `#005CCC` per viewport. Booleans are `ToolSwitch`. Two or three exclusive options are `SettingsSegmented`. Four-plus exclusive are `SettingsSelect`. Destructive and session actions stay ghost until confirm.

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
| Save and train | filled sticky | compile | Assistant on calls |

### Hours (`?tab=train&panel=hours`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Day open | switch × 7 | `hours_schedule` | Assistant on calls |
| Opens / Closes | time input | `hours_schedule` | Assistant on calls |
| When closed | segmented (2) | `after_hours_mode` (`serve` / `message`) | Assistant on calls |
| Save and train | filled sticky | compile | Assistant on calls |

### Locations (`?tab=train&panel=locations`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Label / area / landmark / directions / coverage | table + input + textarea `rows={2}` | `business_locations`, `location_notes` | Assistant on calls |
| Add place | ghost | appends a place | Whole business after Save |
| Remove place | icon ghost | drops a place | Whole business after Save |
| Save and train | filled sticky | compile | Assistant on calls |

### Policies (`?tab=train&panel=policies`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Payment, Holds, Returns, Delivery, Cancellation, Warranty, Other | textarea `rows={2}` | `business_policies` | Assistant on calls |
| When unsure / What to say | textarea `rows={2}` | `unknown_answer_fallback` | Assistant on calls |
| Save and train | filled sticky | compile | Assistant on calls |

### Voice (`?tab=train&panel=tools`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Voice | select (4+) | `soniox_voice_id` | Assistant on calls |
| Voice label | input | `soniox_voice_label` | Whole business (desk label) |
| Hear sample | ghost | preview blob only | This device |
| Alert a teammate | switch | `tool_escalate` | Assistant on calls |
| Hang up after goodbye | switch | `tool_end_call` | Assistant on calls |
| Handoff mode | read-only + link | none here; change in Team | Assistant on calls |
| Save and train | filled sticky | compile | Assistant on calls |

### Pronunciation (`?tab=train&panel=pronunciation`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Practice / Library / Fix | segmented underline | studio tab only | This device |
| Record and train | filled | `tts_lexicon` | Assistant on calls |
| Save spelling | ghost | `tts_lexicon` | Assistant on calls |
| Scan | filled | suggestion queue | This device until Save |
| AI listen | ghost, then filled confirm | Gemini review queue | This device until Save |
| Save and train | filled sticky | `tts_lexicon` compile | Assistant on calls |

### Updates (`?tab=updates`)

Same `DailyBulletinPanel` as Home. One persist path (`bulletinActions` → `daily_bulletin`).

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Callers hear | input | `daily_bulletin` text | Assistant on calls |
| Update duration | segmented (3) | bulletin `expiry` | Assistant on calls |
| Post update | filled, docked | insert live bulletin | Assistant on calls |
| Clear | ghost | expire that item | Assistant on calls |

### Test (`?tab=test`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Generate preview | filled if number pending, else ghost | `/api/pronunciation/preview` | This device |
| Call {DID} | filled if line live | `tel:` | This device + live line |

### FAQs (`?tab=train&panel=faqs`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Common questions | ghost shortcuts | seed `faqs` rows | Whole business after Save |
| Question / Answer | table + input + textarea `rows={2}` | `faqs` | Assistant on calls |
| Add FAQ | ghost | appends a row | Whole business after Save |
| Remove FAQ | icon ghost | drops a row | Whole business after Save |
| Save and train | filled sticky | compile | Assistant on calls |

### Catalog (`?tab=catalog`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Service / product fields | table + inputs | `services_catalog`, `product_catalog` | Assistant on calls |
| Add service / Add 3 / Paste list / Add place-style ghosts | ghost | local rows | Whole business after Save |
| Add to services / Add to products | filled (bulk apply) | catalog arrays | Whole business after Save |
| Save and train | filled sticky | compile | Assistant on calls |

### Import (`?tab=import`)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Paste / Website (knowledge) | segmented (2) | source mode | This device |
| CSV / Paste / Website (products) | segmented (3) | source mode | This device |
| Text / URL | textarea `rows={2}` / input | extract payload | This device until Add |
| Scan | filled, docked | draft | This device |
| Include / keep switches | switch | apply flags | Whole business on Add |
| Keep or replace | segmented (2) | `merge_mode` | Whole business on Add |
| Add to my assistant / Add to catalogue | filled | tenant fields + compile | Whole business + assistant on calls |
| Start over | ghost | clears draft | This device |

### Alerts (`?tab=alerts`)

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
| Handoff | segmented (2) | `handoff_mode` | Assistant on calls |
| Name / Handles / Phone / Email | table + inputs | `team_directory` | Whole business + assistant on calls |
| Escalate / Inbox / Ops | switch | teammate notify flags | Whole business |
| Add person | ghost | appends a row | Whole business after Save |
| Remove person | icon ghost | drops a row | Whole business after Save |
| Save and train | filled sticky | compile | Assistant on calls |

### Appearance (`?tab=appearance`, also lg+ hub)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| This device (System / Light / Dark) | segmented (3) | `localStorage["scalers-desk-theme"]` + `html[data-theme]`. Never tenant / Brain | This device |

Pre-paint script in `app/layout.tsx` reads the same key so the choice survives reload on that browser.

### Sign out (hub header, This device index, lg+ rail)

| Control | Type | Writes | Affects |
| --- | --- | --- | --- |
| Sign out (idle) | ghost | none | This session, after confirm |
| Sign out? | confirm cluster | none until submit | This session |
| Sign out (confirm) | filled | `POST /api/logout` (clears session cookies, Supabase sign-out) | This device session |
| Stay | ghost | dismisses confirm | This device |

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team. Stark destination labels: Identity, Hours, Voice, Pronunciation, Catalog.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Invent a second layout for the same panels

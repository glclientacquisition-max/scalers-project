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

Phone: dense index rows. Tap a row to drill in. `DeskBack` icon, aria-label Profile (`lg:hidden`). lg+: nested inner rail (`lg:w-[13.5rem] shrink-0`, group headers + tabs) beside a fluid panel (`min-w-0 flex-1`). No `max-w-xl` or `max-w-5xl` dead zone. Headers are not links. Active rail tab uses a left `accent` bar and `text-accent-deep`, not a filled pill.

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
| Identity | Label-above inputs; tone and type chip rows | Grouped rows. Name fields. Tone and type selects. Contacts table `md+`, stacked phone |
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
| Appearance | Three filled segment pills | System / Light / Dark underline tabs |
| Sign out | Ghost | Ghost |

Do not invent fields. Do not change compile keys. Alerts persist `whatsapp_notification_number`, `alert_email`, and `notify_channels` without recompiling the assistant prompt.

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team. Stark destination labels: Identity, Hours, Voice, Pronunciation, Catalog.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Invent a second layout for the same panels

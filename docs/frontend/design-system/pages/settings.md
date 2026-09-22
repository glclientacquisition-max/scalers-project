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

Sticky Save on Catalog and Train panels, top-right of the panel header. Updates, Alerts, Import, Test, and Appearance use the same menu without a second compile save.

Bare `/settings` is the hub. lg+ hub shows Appearance in the panel. `?tab=updates` is Updates. `?tab=alerts` is Alerts. `?tab=appearance` is Appearance. Hash `#train` is not routed. `Train` is the verb on Save.

## Chrome

Short in-page title Profile plus compact workspace name and Line live / Number pending. Do not use `deskListTitleClass` on the hub. Muted Sign out on the hub header and in This device (`POST /api/logout`). No giant Business Profile `h1`. Sub-panels keep `DeskBack` plus a short title (Hours, Pronunciation). Save stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`). The desk nav label is Profile. Path stays `/settings`.

Phone index: grouped destination rows (`min-h-12`, label + chevron). lg+ sidebar: group headers + tabs, no chevron. Section titles are non-clickable (`uppercase tracking-wide text-gray-500`). Hover, active, and the canonical focus ring.

Panel titles use `settingsPanelHeadingClass` (`text-xl font-semibold`). Identity and similar forms use `settingsFormGridClass` (`grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4`). Hours is a compact day / open / close grid. Catalog, FAQs, Team, and Locations are tables on `lg+`. Phone stacks.

Primitives in `settingsUi.tsx` define hover, focus, and active. Do not invent a `Button.tsx`.

Density stays 8. Fill the canvas. Do not double page padding or import landing-scale type, glass, or a generic settings card stack. Do not add Billing or Security sections. Appearance is This device only.

## Panels

Inside each destination, group by owner job. Placeholders are examples, not instructions. No `e.g.` prefixes.

| Screen | Blocks |
| --- | --- |
| Identity | Assistant (name, tone) → Business (name, type) → Public contacts |
| Alerts | Alert phone, email, notify channels, text customers, text back missed calls |
| Catalog | Services → Products |
| Hours | Days → When closed |
| Locations | Places: label, area, landmark, directions, coverage |
| Policies | Rules → When unsure |
| Team | Handoff → People: name, handles, phone, email |
| Voice | Voice → Tools. Handoff is read-only. Change in Team. |
| Pronunciation | Coach |
| Updates | Callers hear |
| Import | Paste or Website, then Products |
| Test | Greeting preview, live call |
| Appearance | System, Light, Dark |

Do not invent fields. Do not change compile keys. Alerts persist `whatsapp_notification_number`, `alert_email`, and `notify_channels` without recompiling the assistant prompt.

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team. Stark destination labels: Identity, Hours, Voice, Pronunciation, Catalog.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Invent a second layout for the same panels

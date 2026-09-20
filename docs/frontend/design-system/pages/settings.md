# Profile `/settings`

**Job:** Account hub. Teach and configure the assistant. Sign out.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) Components. Settings primitives live in `settingsUi.tsx`.

## IA

`/settings` is the Profile tab. Bare `/settings` is the account hub: business settings destinations plus muted Sign out. Each settings row is one destination. Same `?tab=` / `?panel=` routes. No new screens.

```text
General     Updates · Assistant · Team · Alerts
Knowledge   Catalog · FAQs · Import
Operations  Hours · Locations · Policies
Line        Tools & voice · Pronunciation · Test
```

Order is who we are, what we know, how we run, prove the line.

Mobile: list or detail. `DeskBack` icon, aria-label Profile (`lg:hidden`). Desktop: list beside the open panel.

Sticky Save on Catalog and Train panels. Updates, Alerts, Import, and Test use the same menu without a second compile save.

Bare `/settings` is the hub. `?tab=updates` is Updates. `?tab=alerts` is Alerts. Hash `#train` is not routed. `Train` is the verb on Save.

## Chrome

Short in-page title Profile plus compact workspace name and Line live / Number pending. Do not use `deskListTitleClass` on the hub. Muted Sign out on the hub header and again below the menu (`POST /api/logout`). No giant Business Profile `h1`. Sub-panels keep `DeskBack` plus a short title (Hours, Pronunciation). Save stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`). The desk nav label is Profile. Path stays `/settings`.

Menu: grouped destination rows (`min-h-12`, label + chevron). Section titles are non-clickable. Hover, active, and the canonical focus ring.

Panel titles use `settingsPanelHeadingClass` (`text-xl`).

Primitives in `settingsUi.tsx` define hover, focus, and active. Do not invent a `Button.tsx`.

Density stays 8. Do not double page padding or import landing-scale type, glass, or a generic settings card stack. Do not add Billing, Security, or Appearance sections that this product does not own.

## Panels

Inside each destination, group by owner job. Placeholders are examples, not instructions. No `e.g.` prefixes.

| Screen | Blocks |
| --- | --- |
| Assistant | Assistant (name, tone) → Business (name, type) → Public contacts |
| Alerts | Alert phone, email, notify channels, text customers, text back missed calls |
| Catalog | Services → Products |
| Hours | Days → When closed |
| Locations | Places: label, area, landmark, directions, coverage |
| Policies | Rules → When unsure |
| Team | Handoff → People: name, handles, phone, email |
| Tools & voice | Voice → Tools. Handoff is read-only. Change in Team. |
| Updates | Callers hear |
| Import | Paste or Website, then Products |

Do not invent fields. Do not change compile keys. Alerts persist `whatsapp_notification_number`, `alert_email`, and `notify_channels` without recompiling the receptionist prompt.

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Invent a second layout for the same panels

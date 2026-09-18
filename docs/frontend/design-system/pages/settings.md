# Settings `/settings` (Business Profile)

**Job:** Teach and configure the assistant.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) Components. Settings primitives live in `settingsUi.tsx`.

## IA

`/settings` is the menu. Each row is one destination. Same `?tab=` / `?panel=` routes. No new screens.

```text
General     Updates · Assistant · Team · Alerts
Knowledge   Catalog · FAQs · Import
Operations  Hours · Locations · Policies
Line        Tools & voice · Pronunciation · Test
```

Order is who we are, what we know, how we run, prove the line.

Mobile: list or detail, with Back to Business Profile. Desktop: list beside the open panel.

Sticky Save on Catalog and Train panels. Updates, Alerts, Import, and Test use the same menu without a second compile save.

Bare `/settings` is the menu. `?tab=updates` is Updates. `?tab=alerts` is Alerts. Hash `#train` is not routed. `Train` is the verb on Save.

## Chrome

Header hierarchy: uppercase “Business Profile” eyebrow, workspace name as `h1` (Sora, clamp 1.5–2rem), Line live / Number pending as caption. Save stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`). The desk nav label is Business so the phone tab fits; do not put Business Profile on `DESK_LINKS`.

Menu: grouped destination rows (`min-h-12`, label + chevron). Section titles are non-clickable. Hover, active, and the canonical focus ring.

Panel titles use `settingsPanelHeadingClass` (`text-xl`). Do not compete with the page `h1`.

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

# Settings `/settings` (Business)

**Job:** Teach and configure the assistant.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) §§6.6–6.7.

## IA

Grouped by owner job. Same `?tab=` / `?panel=` routes. No new screens.

```text
General     Updates · Assistant · Team
Knowledge   Catalog · FAQs · Import
Operations  Hours · Locations · Policies
Line        Tools & voice · Pronunciation · Test
```

Order is who we are, what we know, how we run, prove the line.

Sticky Save on Catalog and Train panels. Updates, Import, and Test use the same sidebar without a second save.

Hash `#train` is not routed. `Train` is the verb on Save, not a sidebar dump drawer.

## Chrome

Header hierarchy: uppercase “Business” eyebrow, workspace name as `h1` (Sora, clamp 1.5–2rem), Line live / Number pending as caption. Save stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`).

Sidebar: MASTER recipe plus `SETTINGS_NAV`. Section titles are non-clickable. Links have hover, active, and the canonical focus ring. `min-h-11`.

Panel titles use `settingsPanelHeadingClass` (`text-xl`). Do not compete with the page `h1`.

Primitives in `settingsUi.tsx` define hover, focus, and active. Do not invent a `Button.tsx`.

Density stays 8. Do not double page padding or import landing-scale type, glass, or a generic settings card stack. Do not add Billing, Security, or Appearance sections that this product does not own.

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Invent a second layout for the same panels

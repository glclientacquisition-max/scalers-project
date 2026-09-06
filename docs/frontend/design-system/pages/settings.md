# Settings `/settings` (Business)

**Job:** Teach and configure the assistant.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) §§6.6–6.7.

## Extracted IA (keep)

```text
Updates · Catalog · Train (header) · Import · Test
```

Train panels: Assistant, Hours, Locations, Policies, Team, FAQs, Tools & voice, Pronunciation.

Sticky Save on Catalog/Train. Updates/Import/Test use the same sidebar without inventing a second save.

Query params: `?tab=` and `?panel=`. Hash `#train` is not routed.

## Chrome

Header hierarchy: uppercase “Business” eyebrow, workspace name as `h1` (Sora, clamp 1.5–2rem), Line live / Number pending as caption. Save stays sticky top-right on form tabs (`SettingsPageHeader` + `TenantSettingsSaveButton`).

Sidebar stays the MASTER recipe (`rounded-2xl border-line`, Train is a non-clickable uppercase header). Links have hover, active, and the canonical focus ring. `min-h-11`.

Panel titles use `settingsPanelHeadingClass` (`text-xl`). Do not compete with the page `h1`.

Primitives in `settingsUi.tsx` define hover, focus, and active. Do not invent a `Button.tsx`.

Density stays 8. Do not double page padding or import landing-scale type, glass, or a generic settings card stack.

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Not Agent Persona. Not Escalation Team.

Allowed line copy: Line live / Number pending. Never Online.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio

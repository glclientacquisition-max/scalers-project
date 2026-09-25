---
name: fixing-accessibility
description: Audit and fix HTML accessibility on the owner desk. Names, keyboard, focus, forms, contrast, 44px hits. Use when adding controls, dialogs, or reviewing WCAG on dashboard UI.
---

# Fixing accessibility (Scalers)

Source: [ibelick/ui-skills](https://github.com/ibelick/ui-skills) `fixing-accessibility` (MIT). Rules kept. Hits and focus bound to desk tokens.

Prefer native HTML. Minimal diffs. Do not migrate to Radix, Base UI, or a new primitive system.

## How to use

`/fixing-accessibility` applies these rules to UI work in the conversation.

`/fixing-accessibility <file>` reports: quoted snippet, why (one sentence), concrete fix.

## Priority

| Priority | Category |
| --- | --- |
| 1 | Accessible names |
| 2 | Keyboard |
| 3 | Focus and dialogs |
| 4 | Semantics |
| 5 | Forms and errors |
| 6 | Announcements |
| 7 | Contrast and 44px hits |
| 8 | Media and motion |

## Rules

**Names.** Every control has an accessible name. Icon-only Confirm, Done, Call, WhatsApp: `aria-label`. Inputs have a label. Links name the destination. Decorative SVG: `aria-hidden`. No "click here".

**Keyboard.** Real `button` / `a` / `input`. All actions reachable by Tab. Visible focus. No `tabindex` greater than 0. Escape closes `DeskDialog`.

**Focus and dialogs.** Trap focus while open. Restore to the trigger. Do not scroll the page away on open. `DeskDialog` stays enter-static (no zoom).

**Semantics.** Native elements over role hacks. Lists use `ul`/`ol`. Tables use `th`. Do not skip heading levels.

**Forms.** Errors use `aria-describedby` and `aria-invalid`. Required is announced. Helper text is associated. A disabled submit explains why.

**Announcements.** Critical errors: `aria-live` or text next to the field. Toasts are not the only channel. `aria-expanded` / `aria-controls` on disclosure.

**Contrast and hits.** Ink on canvas. Small links `#005CCC`, never `#0096FF` as body text. Focus ring `#0096FF`. Primary and secondary actions stay 44px. `deskHitClass` is `h-12 w-12`. Color is not the only disabled signal.

**Motion.** `/desk-motion` only. `prefers-reduced-motion` already kills live, land, pending. Meaningful `alt` or empty alt for decorative images.

## Example

Owner-facing label stays stark. No em dash.

```html
<button type="button" class="deskHitClass" aria-label="Call">
  <svg aria-hidden="true">...</svg>
</button>
```

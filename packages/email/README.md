---
owner: ops-billing
last_reviewed: 2026-10-18
---

# @scalers/email

One design system for Scalers system email: a shared layout, owner and ops templates, and a typed render API. **Templates only.** Nothing here sends mail, and no existing send path calls it yet.

Plan: owner and ops email orchestration (Ops-Billing draft, 18 Oct 2026). Follow-up rules live in `src/catalog.ts` (`followUps`).

## Senders

| Audience | From | Reply-to |
| --- | --- | --- |
| Owner | `Scalers <hello@alerts.scalers.co.ke>` | `support@scalers.co.ke` (**TBD**, placeholder until the inbox exists) |
| Ops (Alvin) | `Scalers ops <platform@ops.scalers.co.ke>` | none |

Both domains are verified in Resend.

## Use

```ts
import { renderEmail } from "@scalers/email"; // packages/email/src/index.ts

const mail = await renderEmail("usage_80", {
  businessName: "Kamau Plumbing", mode: "beta",
  resource: "texts", used: 163, included: 200, resetDate: "1 November", extraUsage: false,
}, { unsubscribeUrl });
// mail: { subject, preheader, html, text, from, replyTo, headers, essential, audience }
```

`renderEmail` is pure: no network, no database. The shared notification module picks the kind, builds the props from `tenant_billing_state`, renders, then sends through its own transport and ledger (`reserve_notify_send`).

## Templates

| Kind | Audience | Essential | CTA (route) |
| --- | --- | --- | --- |
| `welcome` | owner | yes | Open your Desk (`/home`) |
| `line_live` | owner | yes | Test your line (`/home`) |
| `package_changed` (assigned, upgraded, downgrade scheduled) | owner | yes | View your plan (`/wallet`) |
| `usage_80` (minutes or texts) | owner | no | See your usage (`/wallet`) |
| `usage_100` | owner | yes | Turn on extra usage / See your usage (`/wallet`) |
| `usage_100_reminder` (follow-up) | owner | live+off only | same |
| `extra_usage` (on/off) | owner | yes | Review extra usage (`/wallet`) |
| `monthly_summary` | owner | no | See October's calls (`/calls`) |
| `line_paused` | owner | yes | Check line status (`/home`) |
| `line_still_paused` (follow-up) | owner | yes | Check line status (`/home`) |
| `line_restored` | owner | yes | Test your line (`/home`) |
| `setup_nudge` (follow-up) | owner | no | Continue setup (`/onboarding`) |
| `invite_reminder` (follow-up, to invitee) | invitee | yes | Accept invite (invite link) |
| `ops_incident` (open/recovered) | ops | yes | Open client (`/admin/billing/<id>`) or Open Platform |
| `ops_incident_reminder` (follow-up, 4h) | ops | yes | same |
| `ops_digest` (07:30 EAT) | ops | yes | Open Platform; per-client "Open client" links |

Essential mail has no unsubscribe link or `List-Unsubscribe` header. Non-essential mail gets both (one-click) when the caller passes `unsubscribeUrl`.

## Rules the templates follow

- Every owner email reads `mode` (`tenant_billing_state.mode_label`). In beta it says "You're on the free beta, so nothing is charged." Live mode never mentions the beta.
- Owner copy has no vendor names and no wallet, top-up or prepaid language. `test/render.test.ts` fails the build if those words appear.
- No em or en dashes in any copy (tested).
- One primary button per email: VML `v:roundrect` for Outlook desktop, padded link elsewhere, 48px tall. Optional secondary text link.
- Tables for layout, 600px max width, system font stack, light values inlined, dark mode via `prefers-color-scheme` and Outlook.com `[data-ogsc]`. Colours copy the Desk token table in `dashboard/src/app/globals.css`.
- Preheader and a hand-shaped plain-text part on every email, generated from the same spec as the HTML.
- The header mark loads from `https://app.scalers.co.ke/brand/icon-mark.png`. The "Scalers" wordmark next to it is text, so it reads with images off.

## Scripts

```bash
cd packages/email && npm ci
npm run typecheck
npm test
npm run render -- --copy /workspace/scalers/email-previews   # HTML, .txt, desktop 680px + mobile 375px PNGs into out/
```

`render` uses `playwright-core` with a local Chrome (`CHROME_PATH`, or `/usr/bin/google-chrome`).

## Not done here

- No send wiring, scheduler, quiet hours or dedupe. Those belong to the shared notification module.
- Real client checks (Litmus or Email on Acid, Outlook 2016/2019 desktop) haven't been run. The previews are Chromium renders.
- The `support@scalers.co.ke` inbox doesn't exist yet.

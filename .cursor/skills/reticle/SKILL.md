---
name: reticle
description: Prove a user-facing web change in the running app. Use after desk or landing edits, when a fix is claimed but unopened, when tests pass and the UI is still wrong, or when the user asks whether it actually works. Name the consequence before acting. A screenshot alone is not a verdict.
---

# Reticle (Scalers)

Source: [reticlehq/reticle](https://github.com/reticlehq/reticle) `verify-ui-change` (Apache-2.0). Method kept. Product install left out.

A change the owner can see is unproven until the running desk does it and something other than the screenshot agrees.

## Law

Constitution, brand, and lanes stay in charge. This skill does not add a second design system, a glowing HUD, or `present: true` chrome.

Do not run `npx @reticlehq/server init`, do not pipe `install.sh`, and do not write `RETICLE_LICENSE_KEY`. Those steps mutate MCP config and `.env`. The owner installs Reticle MCP on their machine if they want it.

Do not embed a Reticle SDK in `dashboard/`.

## 1. Name the consequence before you act

Write the expected result first. An expectation written after you see the page can be talked into agreeing with whatever happened.

Examples that fit this product:

- Inbox Work row tap opens `/calls/[id]`. Preview stays one truncated line.
- Save stays sticky top-right. Primary is filled `#005CCC` with a white label.
- A 44px Confirm / Done / Call / WhatsApp hit still measures at least 44px after the edit.
- Empty state names the next action. No em dash in the new string.

## 2. Drive the cheapest real path

Stop at the first row that fits.

| Tools present | Drive |
| --- | --- |
| `reticle_*` MCP | One `reticle_act_and_wait` or `reticle_assert`. Other `reticle_*` calls move or read and prove nothing. `verified: unknown` is not a pass. Never weaken a check to go green. |
| Browser tools | Open the changed route as an owner. Click, type, submit, navigate. Check sibling routes that read the same state. Check empty and error if the change touches them. Desktop and a phone width when layout changed. |
| Neither | `curl` the dashboard route or API the change hits. Say what you could not click. |

Desk gate still runs: `cd dashboard && npm run lint` and `npm run build` when the lane contract asks.

## 3. Surfaces

Exercise the path a Kenyan SME owner uses at 08:00 EAT. Common set: `/`, `/calls`, `/calls/[id]`, `/settings`, login/onboarding if you touched them. Confirm `/admin` still rejects owners.

Home queue units stay count nouns. List preview stays `deskPreviewClass` (one ellipsis line). Full hangup copy lives on the record.

## 4. Verdict

| Result | Means |
| --- | --- |
| yes | Named consequence happened. Report the request, the state that moved, the control you hit. |
| no | It did not, or the network contradicted the UI. Report `file:line`. |
| unknown | You drove it and could not tell. Not a pass. |

A single render screenshot is appearance, not behavior.

## Leave

Full Reticle SETUP, license keys, `present: true` narration HUD, desktop-app drive, and replacing `tdd` with Reticle agentic-tdd.

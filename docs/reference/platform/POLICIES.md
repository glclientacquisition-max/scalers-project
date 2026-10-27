---
owner: platform
last_reviewed: 2026-10-25
---

# Policies (Desk ↔ Brain contract)

Owner Desk › Settings › **Policies** (`/settings/policies`) writes one topic at a time into
`tenants.business_policies`. Brain reads the same keys. SQL (not applied yet):
[`docs/supabase/policy_topics.sql`](../../supabase/policy_topics.sql) (down: `policy_topics_down.sql`).
Registry: `dashboard/src/lib/policyRegistry.ts`. Rule cleaning and legacy sentences: `dashboard/src/lib/policyRules.ts`.

## Niches

One registry entry per trade. Adding a trade = adding a `NICHES` entry (and a `TOPICS` entry if
it needs a new topic). No new screen, no schema change.

| Niche | Picked when | Sections → topics |
|---|---|---|
| `cleaning` | name or category has clean / dusted / usafi | Bookings: cancellation, booking_changes, no_show · Money: payment, warranty |
| `retail` | `tenants.vertical` is retail or shop, or name has shop / store / duka / boutique | Orders: returns, delivery · Money: payment, warranty |
| `generic` | anything else | Bookings: cancellation, booking_changes · Money: payment, warranty |

`payment` is a link row to the existing Payments editor (`lib/payments`, key `payment`).
Areas and fees are not in Policies. They live in Service areas (`tenant_area_picks`, see
[AREA_PICKS.md](AREA_PICKS.md)).

## Keys Brain reads

| Path | Shape | Meaning |
|---|---|---|
| `business_policies.policy_lines.<topic>` | `{ "en": string, "sw": string }` | **The line to speak.** Already final wording. Absent = Not set. |
| `business_policies.rules.<topic>` | object, below | The structured answer, for logic (e.g. "can I cancel?" → `allowed`). |
| `business_policies.<text_key>` | string ≤ 500 | Legacy text for the older call paths. Rebuilt on every save. `""` = nothing set. |
| `business_policies.provenance.<text_key>` | `{ source: "owner", confirmed: true }` | Set on each save. |

Text keys: `cancellation` (joins Cancel, Move and Late, in list order), `returns`, `delivery`, `warranty`.

### Rule fields per topic

Every rule has `answer` (the screen choice id). Write my own is `{ answer: "custom", mode: "custom", note, note_sw? }`.
Not set removes the topic from `rules` and `policy_lines` and blanks the text key.

| Topic | Answers → stored fields |
|---|---|
| `cancellation` | `yes` → `allowed: true, notice_hours (0/6/24/48), fee (none/deposit_kept/flat)` · `no` → `allowed: false` |
| `booking_changes` | `yes` → `allowed: true, notice_hours` · `no` → `allowed: false` |
| `no_show` | `wait` → `charge: "none", wait_minutes (10/15/30)` · `callout` → `charge: "callout", wait_minutes` |
| `warranty` | `yes` → `none: false, months (1/3/6/12)` · `no` → `none: true` |
| `returns` | `refund` → `mode: "refund_or_exchange", days (3/7/14), conditions [unused, receipt, packaging]` · `exchange` → `mode: "exchange", days` · `no` → `mode: "none"` |
| `delivery` | `yes` → `mode: "deliver", speed (same_day/next_day/two_three_days)` · `pickup` → `mode: "pickup_only"` |

## Spoken-line contract

1. If `policy_lines.<topic>` exists, speak `en` or `sw` for the caller's language, word for word.
2. If the owner wrote their own words with no Kiswahili, `sw` is `"Timu itathibitisha."` Speak it; don't translate the English.
3. If the topic is absent, say the team will confirm (`"The team will confirm."` / `"Timu itathibitisha."`). Never invent a policy.
4. Own words are ≤ 160 letters, have no phone numbers or links, and were ticked "Checked. OK to say." by the owner. Prices in them were flagged to the owner but are allowed.
5. Areas and fees: read `tenant_area_picks` only. Ignore `rules.delivery.areas` / `fee_ksh` (no longer edited or spoken).

## Saving

`savePolicyTopicAction(topic, draft)` → `set_policy_topic(tenant, topic, rule, line, text_key, text)`:
one UPDATE that touches only `rules.<topic>`, `policy_lines.<topic>`, one text key and its
provenance. Until the SQL is applied, the action reads `business_policies` fresh, patches the
same paths, and writes back only if the row didn't change in between (compare-and-set, 3 tries).

## Shared with Brain (#937)

- Topic ids, names and details: `taxonomy.json` `policy_topics` (dashboard `src/lib/taxonomy.json` and Brain `src/data/taxonomy.json`, kept identical; a test checks). `policyRegistry.ts` adds only screen wording, options and spoken lines.
- **Spoken wording lives in one place: `policy_lines.<topic> = { en, sw }`.** Desk writes it on every save, for every option (Yes, No, Write my own). Brain's `ownerFacts()` speaks it word for word and keeps no copy. A test saves each topic's No option through the Desk path and checks Brain speaks the saved en and sw exactly.
- Each topic reads only its own line. Cancel = No never answers Move or Late.
- Own words: `rules.<topic>.mode = "custom"`, `note` (English), `note_sw` (Kiswahili, optional). Empty `note_sw` is spoken as "Timu itathibitisha."
- Not set: Desk removes `rules.<topic>` and `policy_lines.<topic>`; Brain has nothing to say for it.
- Legacy rows with no `policy_lines` fall back to the text keys, joined with `joinWholeSentences(..., CANCELLATION_TEXT_MAX = 1200)`.
- Late = No (`no_show.allowed = false`) is a valid answer.
- Delivery "Pickup only" saves `mode: "pickup_only"`; Brain handles it.
- Fee amounts (KSh) are not option chips. They stay in follow-up fields and on Service areas.

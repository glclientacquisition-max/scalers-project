---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Package version editor API

Desk builds the Packages screens. This is the server contract. The live catalogue route `POST /api/admin/packages` is unchanged.

A package version is what a Business Assistant package includes: monthly price, included minutes, one shared message-credit allowance, a burn rate for SMS, WhatsApp, and email, seats, numbers, call overage rates, features, and (for the trial only) trial length in days. Published versions are frozen. A new subscription pins the latest published version of the package on that insert. An existing business keeps its version. Current businesses stay on free beta: billing enforcement off, usage metered only. This editor does not move them, turn enforcement on, or create an invoice.

Messages are one allowance. `credit_kes` is the price of one credit and defaults to KSh 1. The owner defaults are 1 credit per SMS segment, 2 credits per WhatsApp alert, and 1 credit per email. A draft copies those burns. An admin can change each one. Changing a burn or the credit price is a price change.

The trial is the package with sku `trial`. It is not on the public catalogue (`is_active` is false). Version 1 is 20 minutes and 14 days. SMS 20 and email 30 on that version are placeholders (`allowances_placeholder` true) and are not the credit pool. Version 1 leaves `message_credits` null. Edit the trial the same way as Starter, Growth, and Scale.

SQL: [`docs/supabase/package_version_editor.sql`](../../supabase/package_version_editor.sql), after [`billing_data_layer.sql`](../../supabase/billing_data_layer.sql). Staging only until Alvin's go. Re-apply the editor file after any re-apply of the data layer.

## Auth

Same gate as the other Super Admin routes: `isLegacyAuthenticated`. A caller who is not a Super Admin gets `403` `{ "error": "ops_only" }` before any database call.

The actor is the signed-in admin (`adminActorName`). Desk must not send `actor`. A body field named `actor` is ignored.

Every write needs `reason`: a non-empty string, at most 500 characters. The database writes that actor and reason to `billing_audit_log` and `ops_audit_log`.

Writes also refuse when the configured database URL is production, unless `ADMIN_PACKAGE_EDITOR_ALLOW_PROD` is exactly `on`. That response is `403` `{ "error": "package_editor_staging_only" }`. GET still lists. Do not set the flag.

## GET `/api/admin/package-versions`

`200`:

```json
{
  "ok": true,
  "price_change_approval_threshold_kes": null,
  "package_editor_enabled": true,
  "new_signup_trial_enabled": false,
  "extra_seat_supported": false,
  "features": [{ "key": "calls", "label": "Calls" }],
  "packages": [
    {
      "id": "uuid",
      "sku": "starter",
      "name": "Starter",
      "is_active": true,
      "versions": []
    }
  ]
}
```

`price_change_approval_threshold_kes` is null when a second admin is not required. `package_editor_enabled` false means the database refuses editor writes (import of a promoted version still works). `new_signup_trial_enabled` defaults false. While it is false, creating a business does not add a subscription. `extra_seat_supported` is true only when `billing_package_versions.extra_seat_monthly_kes` already exists. This editor does not add that column. When it is false, hide the extra-seat field.

`features` is the catalogue. A draft patch must include every key once. Keys today: `calls`, `inbox`, `voicemail`, `bookings`, `catalogue`, `sms_alerts`, `whatsapp_alerts`, `email_alerts`, `staff`.

Each version:

| Field | Meaning |
| --- | --- |
| `id`, `package_id`, `sku`, `name`, `version` | Identity. `version` is 1, 2, 3 on that package. |
| `status` | `draft`, `published`, or `retired`. Archive sets `retired`. |
| `monthly_price_kes` | Monthly price in KSh. Stored. |
| `annual_price_kes` | Annual price in KSh. Stored. A draft patch sends this, not the discount. |
| `annual_discount_percent` | Implied discount, 0 to 100. Rewritten from `annual_price_kes` and `monthly_price_kes` on each draft save. Not sent in the patch. |
| `seats` | Included seats. Integer, zero or more. |
| `minutes` | Included minutes. On sku `trial` these are the trial minutes. |
| `dids` | Phone numbers included. Integer, zero or more. |
| `message_credits` | One shared allowance for SMS, WhatsApp, and email. Null on a seeded version. An editor publish requires a number, zero or more. On sku `trial` these are the trial credits. |
| `sms_credit_burn`, `whatsapp_credit_burn`, `email_credit_burn` | Credits burned per SMS segment, WhatsApp alert, and email. Integers, zero or more. Defaults 1, 2, and 1. Editable on a draft. |
| `credit_kes` | KSh price of one message credit. Default 1. Zero or more. Editable on a draft. |
| `spend_limit_share_percent` | Default on-demand spend cap as a percent of `monthly_price_kes`. Default 50. 0 to 100. Desk reads this column. `billing_spend_limit_kes` from the owner billing actions file still uses 50 percent until that function reads this column. |
| `extra_seat_monthly_kes` | Extra seat price in KSh per month. Present in the JSON only as null when the column is absent. When the column exists, a draft copies it. A null on a new paid draft becomes 500. A published value is not rewritten. Null is allowed (the trial stays null). Omit the key from the patch when `extra_seat_supported` is false. |
| `sms`, `email`, `staff_wa` | Old included buckets. Shown so the seeded numbers stay visible. The editor does not change them. |
| `inbound_kes_per_second`, `outbound_kes_per_second` | Call overage rates, stored per second. The editor shows them per minute. Zero or more. |
| `whatsapp_kes`, `sms_kes`, `email_kes` | Stored on-demand rates. The editor writes the burn into the matching rate. A patch does not send these fields. |
| `trial_days` | 1 to 90 on sku `trial`. Null on every other package. |
| `on_demand_allowed` | False locks on-demand off for that version. The trial version is false. Paid versions are true. Editable on a draft. |
| `allowances_placeholder` | True while the old SMS and email numbers are not a product decision. |
| `active_from` | When this published version becomes the one new signups pin to. A future date does not move anyone and is not the pin target until that time. |
| `published_at`, `retired_at`, `copied_from_id`, `notes`, `price_set_by` | Bookkeeping. `price_set_by` is the last admin who changed a price field on the draft. |
| `subscriber_count` | Businesses pinned to this version. |
| `features` | `{ "key", "label", "enabled" }`. |
| `needs_approval` | True only on a draft that still needs a second admin. |
| `approval` | Latest approval whose price snapshot still matches, or null. |
| `promote_fingerprint` | Set when the version arrived through the promote import. |

`500` `{ "error": "<short message>" }` when the list call fails.

## POST `/api/admin/package-versions`

JSON body `{ "action", "reason", ... }`. Success is `200` `{ "ok": true, ...result }`.

### `draft`

Copy the current published version (latest `active_from` that is already due, otherwise the latest published version) into a new draft. One open draft per package.

```json
{ "action": "draft", "sku": "trial", "reason": "Open a trial draft" }
```

Result: `{ "version_id", "version" }`. Audit action `draft_package_version`.

### `update_draft`

Replace the commercial fields of a draft. Send the whole patch. Counts are integers. Money is zero or more. `features` is the full catalogue, each key once, `enabled` boolean.

```json
{
  "action": "update_draft",
  "version_id": "uuid",
  "reason": "Set included minutes",
  "patch": {
    "monthly_price_kes": 5000,
    "seats": 2,
    "minutes": 300,
    "message_credits": 111,
    "sms_credit_burn": 1,
    "whatsapp_credit_burn": 2,
    "email_credit_burn": 1,
    "dids": 1,
    "inbound_kes_per_second": 0.1,
    "outbound_kes_per_second": 0.15,
    "annual_price_kes": 49800,
    "credit_kes": 1,
    "spend_limit_share_percent": 50,
    "trial_days": null,
    "allowances_placeholder": false,
    "on_demand_allowed": true,
    "features": [{ "key": "calls", "enabled": true }],
    "notes": null
  }
}
```

`message_credits`, the three burn rates, `annual_price_kes`, `credit_kes`, and `spend_limit_share_percent` are required. Do not send `annual_discount_percent`, `sms`, `email`, `staff_wa`, `sms_kes`, `email_kes`, or `whatsapp_kes`. The editor copies each burn into the matching KSh rate and rewrites `annual_discount_percent` from the annual price. An annual price above twelve times the monthly price is refused. It leaves the old included buckets as they were on the copied version. Send `extra_seat_monthly_kes` only when `extra_seat_supported` is true. Null clears it. A number is zero or more.

`trial_days` is required in the patch: null for a paid package, 1 to 90 for `trial`. `on_demand_allowed` is required: true on a paid version, false when on-demand is locked off. `notes` is optional, at most 500 characters. The `features` array above shows the shape of one row. Send every catalogue key. Changing a price, a call rate, a burn, the annual price, the credit price, the spend-limit share, or the extra-seat price sets `price_set_by` to the actor. Changing `message_credits` does not. Audit action `update_package_version_draft`.

Price, seats, minutes, call rates, burns, and the discount above are the live Starter version 1, except `message_credits`. 111 is a fixture shape, not a Scalers allowance. Seeded versions leave that field null. Tests use 1111 and 2222 the same way. Do not invent a commercial price or a credit pool in the client.

### `publish`

```json
{ "action": "publish", "version_id": "uuid", "active_from": "2026-11-01T00:00:00.000Z", "reason": "November signups" }
```

`active_from` is required (past or future, ISO 8601). Publishes the draft. Does not change any subscription. Result includes `subscribers_staying` (businesses on this package still pinned elsewhere). Audit action `publish_package_version`.

Publish refuses a draft whose `message_credits` is null. The error text is `message credits are required`. A promote import of a seeded version may keep the pool null. That path does not use this action.

### `approve`

Second admin, only when `needs_approval` is true. The approver must not be `price_set_by`. The publisher must be a different admin from the approver, so the person who set the price publishes after the other admin approves. A later price edit invalidates the approval. Shared login cannot approve its own price because the actor string matches.

```json
{ "action": "approve", "version_id": "uuid", "reason": "Price checked" }
```

Audit action `approve_package_version`.

### `archive`

Published version becomes `retired`. Refuses when it is the only published version of that package. Does not move subscribers.

```json
{ "action": "archive", "version_id": "uuid", "reason": "Superseded" }
```

Audit action `archive_package_version`.

### `discard_draft`

Deletes a draft and its features. Refuses if a business is pinned to it.

```json
{ "action": "discard_draft", "version_id": "uuid", "reason": "Drop the draft" }
```

Result: `{ "version_id", "discarded": true }`. Audit action `discard_package_version_draft`.

### `move_subscribers`

An explicit admin move. `confirm` must be `true`. Moves any business onto any published version, including a different plan, and including a business whose billing status is beta or whose billing enforcement is off. 1 to 200 tenant ids. Copies `minutes_included` from the version (and `seat_included` when that column exists). Leaves `billing_status` and `billing_enforcement` unchanged, so a beta business stays free and is metered against the new minutes. Does not create an invoice. A business with no subscription gets one, status beta, enforcement untouched.

A direct database update, and `system_move_subscribers_to_package_version` (renewals, trial expiry, cron), still skip a beta business or one with enforcement off. The skip writes audit action `skip_package_version`. Nothing in those paths turns enforcement on.

```json
{
  "action": "move_subscribers",
  "version_id": "uuid",
  "tenant_ids": ["uuid"],
  "reason": "Move this business onto version 2",
  "confirm": true
}
```

Result: `{ "version_id", "moved", "version" }`. One audit row per business, action `move_package_version`. The row stores actor, tenant, reason, `moved_at`, from version, to version, and billing status and enforcement before and after. `created_at` on `billing_audit_log` is the timestamp.

### `set_billing_mode`

Beta and billing are one switch. The only pairs are `billing_status` `beta` with `enforcement` `off`, and `billing_status` `active` with `enforcement` `soft` or `hard`. Any other pair is refused. `confirm` must be `true`. The plan, the version, and the minutes stay put. Does not create an invoice.

```json
{
  "action": "set_billing_mode",
  "tenant_id": "uuid",
  "billing_status": "active",
  "enforcement": "soft",
  "reason": "Turn billing on",
  "confirm": true
}
```

Audit action `set_tenant_billing_mode`, with status and enforcement before and after. `POST /api/admin/billing` uses this same call: mode `off` is beta with enforcement off, and mode `soft` or `hard` is active with that enforcement. The older `set_tenant_billing_mode` refuses to turn enforcement on while the subscription is still beta, and it does not change `billing_status`.

### `set_new_signup_trial`

Turns `new_signup_trial_enabled` on or off. `confirm` must be `true`. Does not change an existing business and does not turn enforcement on.

```json
{
  "action": "set_new_signup_trial",
  "enabled": false,
  "reason": "Leave new signups without a trial",
  "confirm": true
}
```

Audit action `set_new_signup_trial`.

### `set_price_approval_threshold`

```json
{ "action": "set_price_approval_threshold", "threshold_kes": null, "reason": "Turn the second admin off" }
```

`threshold_kes` null turns the rule off. A number (zero or more) turns it on. Zero means any monthly price change. Any change to a call overage rate, a burn rate, or the annual discount also needs approval while a threshold is set. Allowance edits (`message_credits`, minutes, seats, features, trial length, `on_demand_allowed`) do not. Audit action `set_price_approval_threshold`.

## Errors

| HTTP | `error` | When |
| --- | --- | --- |
| 403 | `ops_only` | Not a Super Admin. |
| 403 | `package_editor_staging_only` | Write while the app is pointed at production. |
| 403 | `package_editor_off` | `package_editor_enabled` is false. |
| 400 | `invalid` | Body is not JSON, or a field failed a check. `message` is the reason. |
| 409 | `approval_required` | Publish needs a second admin. |
| 409 | `draft_exists` | This package already has a draft. |
| 409 | `version_frozen` | The version is published. Edit the draft, or start a new one. |
| 500 | short message | Anything else the database refused. |

`message` on 400 and 409 is the database text, capitalized, at most 180 characters. It does not name vendors, SQL files, or environment variables.

Checks the database enforces, in addition to the route: no negative numbers, reason required, actor required, trial length only on `trial`, every feature key once, discount 0 to 100, notes at most 500 characters, `message_credits` set before an editor publish, cannot archive the only published version, an admin move needs `confirm: true`, a system move skips a beta business, a move does not change billing status or enforcement, and a move does not create an invoice.

## What publish does not do

- It does not move existing subscribers. A new subscription pins to the latest published version whose `active_from` is already due. Changing the package on an existing subscription keeps the same version number. It does not attach a later version.
- It does not charge, send a message, turn billing enforcement on, create an invoice, or change the live rate card used by today's catalogue screen.
- It does not put the trial on the public catalogue.
- It does not make sending spend `message_credits`. Notify, consume, and the wallet still read the old SMS, WhatsApp, and email buckets. Burning one shared pool is a later change. Until then the editor only stores the allowance and the per-channel burn, and mirrors each burn into `sms_kes`, `whatsapp_kes`, and `email_kes`.
- It does not enforce `on_demand_allowed` on a call. That flag is stored on the version. Sending still follows the business on-demand switch. Enforcement is a later change.

## Owner price table

[`package_version_owner_prices.sql`](../../supabase/package_version_owner_prices.sql) publishes the locked prices (ex-VAT, KSh) through the editor functions. Staging only. It does not move a business, change billing enforcement, or create an invoice. Current businesses stay on free beta. The new versions apply only when a new subscription is inserted. It does not change `billing_packages` or `billing_rate_card`, so the public catalogue screen keeps the previous prices until Desk reads versions. A second run does not publish another version. It refuses when the editor is off, when a second-admin threshold is set, or when a draft is already open. It also refuses if a pin, a billing mode, or an invoice count changed during the run.

These figures are the seeded version 2 rows. Message credits are 1,000 on Starter, 2,500 on Growth, 5,500 on Scale, and 70 on the trial. Burn rates on version 2 are SMS 1, WhatsApp 2, and email 1. `credit_kes` is 1. Inbound overage is 26, 25, and 24 per minute. Outbound overage is 34 per minute on all four, including the trial. The trial version is 14 days, 20 minutes, 70 credits, and on-demand is locked off. `spend_limit_share_percent` is 50 on each version.

Annual price is the usual rounding of monthly times 12 times (1 minus the discount). Starter discount is 17 percent. Growth and Scale are 10 percent. Call rates are stored per second at 5 decimals, the same rounding the desk uses, so the minute figures below display back as written.

| Package | Monthly | Annual | Minutes | Seats | Numbers | Credits | Inbound overage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Starter | 7,000 | 69,720 | 300 | 3 | 1 | 1,000 | 26 / min |
| Growth | 18,000 | 194,400 | 800 | 8 | 1 | 2,500 | 25 / min |
| Scale | 35,000 | 378,000 | 1,600 | 20 | 1 | 5,500 | 24 / min |
| Trial | 0 | 0 | 20 | 2 | 1 | 70 | copied |

Trial version 2 is 14 days, 20 minutes, and 70 credits. `on_demand_allowed` is false, so the stored call rates are not offered. Seats and numbers stay the copied version 1 values (2 and 1). Inbound stays the copied version 1 rate (0.10 per second). The owner table did not set a trial inbound price, and 0 would be a free rate. `allowances_placeholder` is false on these four versions because the credit numbers are an owner decision. The old `sms`, `email`, and `staff_wa` columns are copied from the previous version and left as they are. Version 1 stays published and unchanged.

## New signup trial

A business is created by `handle_new_user_tenant` when someone signs up with a business name. Onboarding updates that business. It does not create one. An invite signup does not create a business.

`new_signup_trial_enabled` on `billing_lifecycle_settings` defaults false. While it is false, signup does not add a subscription. When the owner sets it true, inserting a business that has no subscription pins the latest published trial version. Billing enforcement stays off. `trial_ends_at` stays empty. Trial expiry is a later change. Existing businesses are not updated. Turn it on with:

```sql
update public.billing_lifecycle_settings
set new_signup_trial_enabled = true
where id = 1;
```

Do not set that on production until the owner says so. Staging stays false.

## Promote a version from staging to production

`scripts/promote-package-version.js` exports one published version and imports it on another database. Import writes audit action `promote_package_version`, checks the fingerprint, and does not move subscribers. A second import of the same fingerprint returns the existing row (`already_present: true`). Import does not require `package_editor_enabled`. A file may leave `message_credits` null so a seeded version can move without inventing a pool. Burn rates travel with the file. When a burn is missing, import copies the matching KSh rate.

```
node scripts/promote-package-version.js export --version-id <uuid> --out version.json
node scripts/promote-package-version.js import --file version.json --actor <name> --reason <text>
```

Environment names only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The script refuses the production project unless `PACKAGE_VERSION_PROMOTE_ALLOW_PROD` is exactly `yes`. Do not set that, and do not run the import against production, until a backup and Alvin's go.

File shape `scalers.package_version.v1`: `format`, `sku`, `source_version`, `source_version_id`, `fingerprint`, `terms`, `features`. Export adds `source_project_ref` from the URL host.

---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Package version editor API

Desk builds the Packages screens. This is the server contract. The live catalogue route `POST /api/admin/packages` is unchanged.

A package version is what a Business Assistant package includes: monthly price, included minutes, SMS, email, seats, staff WhatsApp, numbers, overage rates, features, and (for the trial only) trial length in days. Published versions are frozen. A business stays on the version it was given until an admin moves it.

The trial is the package with sku `trial`. It is not on the public catalogue (`is_active` is false). Version 1 is 20 minutes and 14 days. SMS 20 and email 30 on that version are placeholders (`allowances_placeholder` true). Edit it the same way as Starter, Growth, and Scale.

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

`price_change_approval_threshold_kes` is null when a second admin is not required. `package_editor_enabled` false means the database refuses editor writes (import of a promoted version still works).

`features` is the catalogue. A draft patch must include every key once. Keys today: `calls`, `inbox`, `voicemail`, `bookings`, `catalogue`, `sms_alerts`, `whatsapp_alerts`, `email_alerts`, `staff`.

Each version:

| Field | Meaning |
| --- | --- |
| `id`, `package_id`, `sku`, `name`, `version` | Identity. `version` is 1, 2, 3 on that package. |
| `status` | `draft`, `published`, or `retired`. Archive sets `retired`. |
| `monthly_price_kes` | Monthly price in KES. |
| `annual_price_kes` | Computed: monthly times 12 times (1 minus `annual_discount_percent` / 100), rounded. Not stored. |
| `seats`, `minutes`, `sms`, `email`, `staff_wa`, `dids` | Included counts. Integers, zero or more. |
| `inbound_kes_per_second`, `outbound_kes_per_second`, `whatsapp_kes`, `sms_kes`, `email_kes` | Overage rates. Zero or more. |
| `annual_discount_percent` | 0 to 100. |
| `trial_days` | 1 to 90 on sku `trial`. Null on every other package. |
| `allowances_placeholder` | True while SMS and email numbers are not a product decision. |
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
    "sms": 200,
    "email": 100,
    "staff_wa": 0,
    "dids": 1,
    "inbound_kes_per_second": 0.1,
    "outbound_kes_per_second": 0.15,
    "whatsapp_kes": 2,
    "sms_kes": 1,
    "email_kes": 1,
    "annual_discount_percent": 17,
    "trial_days": null,
    "allowances_placeholder": false,
    "features": [{ "key": "calls", "enabled": true }],
    "notes": null
  }
}
```

`trial_days` is required in the patch: null for a paid package, 1 to 90 for `trial`. `notes` is optional, at most 500 characters. The `features` array above shows the shape of one row. Send every catalogue key. Changing a price or rate sets `price_set_by` to the actor. Audit action `update_package_version_draft`.

The numbers above are the live Starter version 1, not a new price. Tests use obvious fixtures such as 1111. Do not invent a commercial price in the client.

### `publish`

```json
{ "action": "publish", "version_id": "uuid", "active_from": "2026-11-01T00:00:00.000Z", "reason": "November signups" }
```

`active_from` is required (past or future, ISO 8601). Publishes the draft. Does not change any subscription. Result includes `subscribers_staying` (businesses on this package still pinned elsewhere). Audit action `publish_package_version`.

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

The only way to take a business off the version it is grandfathered on. Target must be published and the same package. 1 to 200 tenant ids. Does not change billing status, included minutes, or enforcement.

```json
{
  "action": "move_subscribers",
  "version_id": "uuid",
  "tenant_ids": ["uuid"],
  "reason": "Move this business onto version 2"
}
```

Result: `{ "version_id", "moved", "version" }`. One audit row per business, action `move_package_version`.

### `set_price_approval_threshold`

```json
{ "action": "set_price_approval_threshold", "threshold_kes": null, "reason": "Turn the second admin off" }
```

`threshold_kes` null turns the rule off. A number (zero or more) turns it on. Zero means any monthly price change. Any change to an overage rate or the annual discount also needs approval while a threshold is set. Allowance edits (minutes, SMS counts, seats, features, trial length) do not. Audit action `set_price_approval_threshold`.

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

Checks the database enforces, in addition to the route: no negative numbers, reason required, actor required, trial length only on `trial`, every feature key once, discount 0 to 100, notes at most 500 characters, cannot archive the only published version, move stays on the same package.

## What publish does not do

- It does not move existing subscribers. New signups pin to the latest published version whose `active_from` is already due.
- It does not charge, send SMS, or change the live rate card used by today's catalogue screen.
- It does not put the trial on the public catalogue.

## Promote a version from staging to production

`scripts/promote-package-version.js` exports one published version and imports it on another database. Import writes audit action `promote_package_version`, checks the fingerprint, and does not move subscribers. A second import of the same fingerprint returns the existing row (`already_present: true`). Import does not require `package_editor_enabled`.

```
node scripts/promote-package-version.js export --version-id <uuid> --out version.json
node scripts/promote-package-version.js import --file version.json --actor <name> --reason <text>
```

Environment names only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The script refuses the production project unless `PACKAGE_VERSION_PROMOTE_ALLOW_PROD` is exactly `yes`. Do not set that, and do not run the import against production, until a backup and Alvin's go.

File shape `scalers.package_version.v1`: `format`, `sku`, `source_version`, `source_version_id`, `fingerprint`, `terms`, `features`. Export adds `source_project_ref` from the URL host.

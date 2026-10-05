# Platform ops mail

Staff notices from Admin → Platform. Not owner leads and not caller alerts.

## Sender

Use `ops.scalers.co.ke` (Vercel DNS on `scalers.co.ke`).

| Env | Where |
| --- | --- |
| `OPS_EMAIL_FROM=Scalers ops <platform@ops.scalers.co.ke>` | Staging desk (`scalers-staging`) and Railway staging Voice (set 2026-10-05). |
| `RESEND_API_KEY` | Already on Railway staging Voice. Copy the same key onto the staging desk so Platform can create the domain and send. |

Owner mail stays on `ALERT_EMAIL_FROM`.

On Platform, **Create domain** calls Resend for `ops.scalers.co.ke` and shows MX / SPF / DKIM. Add those records on `scalers.co.ke`, then **Check DNS**.

## SQL

`docs/supabase/platform_ops_notices.sql` is applied on **scalers-staging** (`sgcdncjxauhsbunobmob`) as migration `platform_ops_notices` (2026-10-05). Singleton row id=1 exists. Do not apply to production ALCR until this ships.

Until production has the tables, production Platform still shows live cards and does not persist recipients.

## Types (v1)

Speech, reasoning, phone line, phone wallet low, number pool empty, beta expired.

Recipients and type toggles live on Platform. A process restart keeps open notices in the table.

## Evaluate

Overview and Platform load run `evaluatePlatformOps`. That opens or resolves notices and sends ops mail. Voice still has its own speech / reasoning / telephony SMS path from env phones.

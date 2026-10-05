# Platform ops mail

Staff notices from Admin → Platform. Not owner leads and not caller alerts.

## Sender

Use `ops.scalers.co.ke` (you control `scalers.co.ke` DNS).

| Record | Value |
| --- | --- |
| MX / verification | Resend domain docs for `ops.scalers.co.ke` |
| SPF / DKIM / DMARC | Resend-published records on that host |

Set on the desk:

```
RESEND_API_KEY=...
OPS_EMAIL_FROM=Scalers ops <platform@ops.scalers.co.ke>
```

Owner mail stays on `ALERT_EMAIL_FROM`.

## SQL

Apply `docs/supabase/platform_ops_notices.sql` on staging, then production. Until then, Platform still shows live cards. Recipients and notice state do not persist.

## Types (v1)

Speech, reasoning, phone line, phone wallet low, number pool empty, beta expired.

Recipients and type toggles live on Platform. A process restart keeps open notices in the table.

## Evaluate

Overview and Platform load run `evaluatePlatformOps`. That opens or resolves notices and sends ops mail. Voice still has its own speech / reasoning / telephony SMS path from env phones.

---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Platform escalate mail

Staff notices from Admin → Platform → Escalate. Not owner leads and not caller alerts.

Sender stays `OPS_EMAIL_FROM` on `ops.scalers.co.ke`. Domain, DNS, and Resend keys are infra. They are not Admin controls.

People (name, phone, email) live on `platform_ops_settings.people`. Mail still uses the email list derived from those people.

SQL: `platform_ops_notices.sql` then `platform_ops_people.sql`. Both tables are already on staging and production. `GET /api/cron/ops-alerts` opens, resolves, and mails these notices. Voice calls it. There is no Vercel cron. A Platform page load does not mail. Dry run is the default (`OPS_ALERTS_DRY_RUN` unset). Staging never sends. Production mail waits on `CRON_SECRET` (16+ characters) and `OPS_ALERTS_DRY_RUN=false`. Contract: [`OPS_ALERTS_ENDPOINT.md`](OPS_ALERTS_ENDPOINT.md). Owner call alerts stay on the Voice send path. Speech and reasoning mail stay on Voice.

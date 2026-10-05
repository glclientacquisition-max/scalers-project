# Platform escalate mail

Staff notices from Admin → Platform → Escalate. Not owner leads and not caller alerts.

Sender stays `OPS_EMAIL_FROM` on `ops.scalers.co.ke`. Domain, DNS, and Resend keys are infra. They are not Admin controls.

People (name, phone, email) live on `platform_ops_settings.people`. Mail still uses the email list derived from those people.

SQL: `platform_ops_notices.sql` then `platform_ops_people.sql`. Applied on scalers-staging. Do not apply to production ALCR until this ships.

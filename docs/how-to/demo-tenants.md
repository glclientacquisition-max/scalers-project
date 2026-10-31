---
owner: desk
last_reviewed: 2026-10-31
---

# Browser demo tenants

Three made-up businesses for the browser voice demo. They exist so a visitor can hear Home services, a Shop, or Other business. They are not real customers.

| Slug | Public key | Business | Type |
| --- | --- | --- | --- |
| `demo_home` | `home` | Amani Visit Services | Home services |
| `demo_shop` | `shop` | Nuru Lane Electronics | Shop |
| `demo_other` | `other` | Pendo Office Help | Other business |

The shop prices are the 15 rows in `fixtures/demo-tenants.json`. The spoken price comes from `pinSpokenCatalogue` on that list.

## is_demo

There is no `tenants.is_demo` column, and this work does not add one. No SQL is applied.

A tenant is a demo only when its id or slug is one of the three fixed ids in `src/demo/tenants.js`. `business_policies.demo` on any other row is ignored. `+254709221536` is never a demo.

For those three ids:

- Bookings do not insert. `createAppointment` and `createServiceRequest` return a demo sink (`external: false`). Brain capabilities turn booking, holds, escalation and live transfer off. Answers from the file stay on.
- Notifications do not send. `beginInstanceSend` returns `demo_tenant` before SMS, WhatsApp or email. Storing every notify channel off is not enough on its own: `parseNotifyChannels` turns SMS back on when all three are off. The send gate is the block.
- Billing does not debit. The row is `billing_enforcement = off` and on-demand is off. `quoteDemoBilling` forces `debitKes` to 0 even if a caller passes enforcement `hard`.

Phone columns are `pending:demo_home`, `pending:demo_shop` and `pending:demo_other`. They are not dialable numbers.

## Run

Alvin or Chief runs this on a machine that already has the staging service role. An agent does not run it. CI does not run it.

Dry run, writes nothing:

```bash
RAILWAY_ENVIRONMENT=staging \
SUPABASE_URL=https://sgcdncjxauhsbunobmob.supabase.co \
node scripts/seed-demo-tenants.js
```

Upsert the three ids only:

```bash
RAILWAY_ENVIRONMENT=staging \
SUPABASE_URL=https://sgcdncjxauhsbunobmob.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/seed-demo-tenants.js --apply
```

The script refuses unless `RAILWAY_ENVIRONMENT` is the exact value `staging` and `SUPABASE_URL` contains the staging project ref `sgcdncjxauhsbunobmob`. A prod URL (`fjxcdccgyhnvnnlnovcl`) is refused even if the Railway name says staging. `--apply` aborts if one of the three ids already holds a number that is not its `pending:demo_` placeholder.

## Remove

Deletes only those three ids, and only when each stored number is still `pending:demo_…`. Any other number, including `+254709221536`, aborts the delete.

```bash
RAILWAY_ENVIRONMENT=staging \
SUPABASE_URL=https://sgcdncjxauhsbunobmob.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/seed-demo-tenants.js --remove
```

## Preview

`/dev/demo-tenants` lists the fixture when `DASHBOARD_OPEN=true`. It is not a public page and it does not write.

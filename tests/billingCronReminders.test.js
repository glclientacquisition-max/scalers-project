// Billing schedules run in pg_cron; invoice reminders default OFF (migration 20261031040000).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261031040000_billing_pg_cron_reminders.sql", "utf8");

describe("billing pg_cron and reminders", () => {
  it("Vercel no longer schedules billing", () => {
    assert.equal(JSON.parse(readFileSync("dashboard/vercel.json", "utf8")).crons, undefined);
  });
  it("schedules retry, reminders and reconcile in pg_cron", () => {
    for (const job of ["billing-payment-retry", "billing-invoice-reminders", "billing-reconcile-daily"]) {
      assert.match(sql, new RegExp(`cron\\.schedule\\('${job}'`));
    }
  });
  it("reminders are off until the policy is set", () => {
    assert.match(sql, /reminders_enabled boolean not null default false/);
    for (const col of ["reminder_due_soon_days", "reminder_overdue_grace_days", "reminder_followup_days", "reminder_suspend_day"]) {
      assert.match(sql, new RegExp(`add column if not exists ${col} integer,`), `${col} must have no default`);
    }
    assert.match(sql, /reminder_max_followups between 0 and 2/);
  });
  it("stops once paid, skips paused invoices, respects quiet hours, never suspends", () => {
    assert.match(sql, /i\.status = 'open'/);
    assert.match(sql, /coalesce\(i\.total_kes, 0\) - coalesce\(i\.amount_paid_kes, 0\) > 0/);
    assert.match(sql, /i\.reminders_paused_at is null/);
    assert.match(sql, /billing_in_quiet_hours\(now\(\)/);
    assert.doesNotMatch(sql, /admin_set_business_suspended|line_status/);
  });
  it("keeps the cron secret out of git", () => {
    assert.match(sql, /vault\.decrypted_secrets where name = 'billing_cron_secret'/);
    assert.doesNotMatch(sql, /Bearer [A-Za-z0-9]{12,}/);
  });
});

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let ownerBillingRefusal;
let deskPlanChangeOn;
let billingWritesAllowed;

before(async () => {
  ({ ownerBillingRefusal, deskPlanChangeOn, billingWritesAllowed } = await import(
    "../dashboard/src/lib/ownerBilling.ts"
  ));
});

const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "docs/supabase/owner_billing_actions.sql"), "utf8");
const prod = fs.readFileSync(path.join(root, "docs/supabase/prod/owner_billing_actions.sql"), "utf8");

const BANNER = `-- PRODUCTION SCRIPT. Do not run until a backup and Alvin's GO.
-- Production project: fjxcdccgyhnvnnlnovcl. Staging first: sgcdncjxauhsbunobmob.
-- This file is docs/supabase/owner_billing_actions.sql with this banner.
-- No payment provider. Beta businesses (billing enforcement off) return code beta.

`;

function env(over) {
  return { DESK_PLAN_CHANGE: "on", SUPABASE_URL: "https://sgcdncjxauhsbunobmob.supabase.co", ...over };
}

describe("owner billing desk gate", () => {
  it("stays off unless DESK_PLAN_CHANGE is exactly on", () => {
    assert.equal(deskPlanChangeOn({}), false);
    assert.equal(deskPlanChangeOn({ DESK_PLAN_CHANGE: "true" }), false);
    assert.equal(deskPlanChangeOn({ DESK_PLAN_CHANGE: "on" }), true);
    const off = ownerBillingRefusal({
      env: env({ DESK_PLAN_CHANGE: "" }),
      userId: "u",
      tenantId: "t",
      role: "owner",
    });
    assert.equal(off.code, "disabled");
  });

  it("refuses the production database before it looks at the person", () => {
    assert.equal(
      billingWritesAllowed({ SUPABASE_URL: "https://fjxcdccgyhnvnnlnovcl.supabase.co", DESK_PLAN_CHANGE: "on" }),
      false
    );
    const refused = ownerBillingRefusal({
      env: env({ NEXT_PUBLIC_SUPABASE_URL: "https://fjxcdccgyhnvnnlnovcl.supabase.co", SUPABASE_URL: "" }),
      userId: "u",
      tenantId: "t",
      role: "owner",
    });
    assert.equal(refused.code, "production_refused");
  });

  it("allows an owner or an admin on staging and refuses everyone else", () => {
    assert.equal(
      ownerBillingRefusal({ env: env(), userId: "u", tenantId: "t", role: "owner" }),
      null
    );
    assert.equal(
      ownerBillingRefusal({ env: env(), userId: "u", tenantId: "t", role: "admin" }),
      null
    );
    assert.equal(
      ownerBillingRefusal({ env: env(), userId: null, tenantId: "t", role: "owner" }).code,
      "sign_in"
    );
    assert.equal(
      ownerBillingRefusal({ env: env(), userId: "u", tenantId: null, role: "owner" }).code,
      "no_workspace"
    );
    assert.equal(
      ownerBillingRefusal({ env: env(), userId: "u", tenantId: "t", role: "staff" }).code,
      "forbidden"
    );
  });
});

describe("owner billing sql contract", () => {
  it("keeps the prod script identical to the canonical file plus the banner", () => {
    assert.equal(prod, BANNER + sql);
  });

  it("reads the version spend share and falls back to 50", () => {
    const fn = sql.slice(sql.indexOf("function public.billing_spend_limit_kes"));
    const body = fn.slice(0, fn.indexOf("comment on function public.billing_spend_limit_kes"));
    assert.match(body, /spend_limit_share_percent/);
    assert.match(body, /attisdropped/);
    assert.match(body, /coalesce\(v_share, 50\)/);
    assert.match(body, /v_monthly \* v_share \/ 100/);
  });

  it("hooks spend checks into consume, reserve, and escalation", () => {
    const call = sql.slice(sql.indexOf("function public.consume_call_seconds"));
    assert.match(call.slice(0, 7000), /billing_spend_allows_charge/);
    const sms = sql.slice(sql.indexOf("function public.consume_sms_units"));
    assert.match(sms.slice(0, 4500), /billing_spend_allows_charge/);
    const reserve = sql.slice(sql.indexOf("function public.reserve_notify_send"));
    assert.match(reserve.slice(0, 6000), /billing_spend_allows_charge/);
    const esc = sql.slice(sql.indexOf("function public.tenant_escalation_allowed"));
    assert.match(esc.slice(0, 4000), /billing_on_demand_open/);
  });

  it("does not call a payment provider", () => {
    assert.doesNotMatch(sql, /api\.bachs|daraja|stripe\.com|mpesa/i);
    const actions = fs.readFileSync(path.join(root, "dashboard/src/lib/ownerBillingActions.ts"), "utf8");
    assert.match(actions, /owner_change_plan/);
    assert.match(actions, /owner_set_extra_seats/);
    assert.match(actions, /owner_set_spend_limit/);
    assert.doesNotMatch(actions, /bachs|daraja|stripe/i);
  });
});

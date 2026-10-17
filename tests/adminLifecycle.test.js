/**
 * Super Admin lifecycle: Suspend / Restore line, Archive / Unarchive, scheduled purge.
 * - Suspend reuses line_status = 'suspended', which the voice gate (#651) already refuses
 *   before any call row, so a refused call is never metered or charged.
 * - Every action needs a typed reason (3+) and a ConfirmSheet, and records the session actor.
 * - Archive stops billing through the existing billing-mode RPC, hides the business from the
 *   default list, and blocks owner sign-in.
 * - No hard delete in Admin. purge_archived_tenants defaults to a dry run; the schedule file
 *   is separate and not applied.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const model = require("../dashboard/src/lib/adminBusinessModel.ts");
const gate = require("../src/sautikit/inactiveTenantGate.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const DASH = "dashboard/src";

function fnBody(src, name) {
  const start = src.search(new RegExp(`export async function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next >= 0 ? rest.slice(0, next) : rest;
}

describe("lifecycle model", () => {
  const day = 24 * 60 * 60 * 1000;

  it("the restore window lives in one constant", () => {
    assert.equal(model.ARCHIVE_RESTORE_DAYS, 30);
    const hits = [];
    for (const rel of [`${DASH}/lib/adminBusinessModel.ts`, `${DASH}/lib/adminBusinessActions.ts`, `${DASH}/components/AdminBusinessesPanel.tsx`, `${DASH}/lib/admin.ts`]) {
      if (/ARCHIVE_RESTORE_DAYS\s*=/.test(read(rel))) hits.push(rel);
    }
    assert.deepEqual(hits, [`${DASH}/lib/adminBusinessModel.ts`]);
    assert.doesNotMatch(read(`${DASH}/components/AdminBusinessesPanel.tsx`), /\b30 days\b/);
  });

  it("archived beats suspended beats live, same order as the voice gate", () => {
    const archivedAt = "2026-10-01T09:00:00.000Z";
    assert.equal(model.businessLifecycle({ isActive: false, archivedAt, lineStatus: "suspended" }).state, "archived");
    assert.equal(model.businessLifecycle({ isActive: true, archivedAt: null, lineStatus: "suspended", suspendedAt: archivedAt }).state, "suspended");
    assert.equal(model.businessLifecycle({ isActive: true, archivedAt: null, lineStatus: "grace" }).state, "live");
    const billing = model.businessLifecycle({ isActive: true, archivedAt: null, lineStatus: "suspended", suspendedAt: null });
    assert.deepEqual(billing, { state: "suspended", byAdmin: false });
  });

  it("the purge date is archive + 30 days, null without a date", () => {
    const at = new Date("2026-10-17T10:00:00.000Z");
    assert.equal(model.purgeDate(at.toISOString()), new Date(at.getTime() + 30 * day).toISOString());
    assert.equal(model.purgeDate(null), null);
    assert.equal(model.purgeDate("not a date"), null);
  });

  it("a reason needs 3 characters after trimming", () => {
    assert.throws(() => model.requireReason("  ab "), (err) => model.isAdminActionBlocked(err));
    assert.throws(() => model.requireReason(undefined), (err) => model.isAdminActionBlocked(err));
    assert.equal(model.requireReason("  late payment "), "late payment");
    assert.equal(model.reasonOk("ab"), false);
    assert.equal(model.reasonOk("abc"), true);
  });
});

describe("suspend reuses the voice gate", () => {
  it("line_status suspended is a closed line; grace still answers", () => {
    assert.equal(gate.isTenantLineInactive({ is_active: true, line_status: "suspended" }), true);
    assert.equal(gate.isTenantLineInactive({ is_active: true, line_status: "grace" }), false);
    assert.equal(gate.isTenantLineInactive({ is_active: true, archived_at: "2026-10-17T10:00:00Z" }), true);
  });

  it("the gate refuses before any call row, so nothing is metered", () => {
    const src = read("src/sautikit/inactiveTenantGate.js");
    assert.match(src, /before Stream and before the call row/);
    assert.match(src, /no call row,\s*\n\/\/ no minutes/);
  });

  it("the SQL writes line_status through an RPC and uses the allowed values", () => {
    const sql = read("docs/supabase/admin_business_suspend.sql");
    assert.match(read("docs/supabase/line_rental_grace.sql"), /check \(line_status in \('active', 'grace', 'suspended'\)\)/);
    assert.match(sql, /set line_status = 'suspended'/);
    assert.match(sql, /set_config\('scalers\.wallet_write', '1', true\)/);
    assert.match(sql, /Suspended for non-payment/);
    assert.match(sql, /grant execute on function public\.admin_set_business_suspended\(uuid, boolean, text\) to service_role/);
    assert.match(sql, /revoke all on function public\.admin_set_business_suspended\(uuid, boolean, text\) from public, anon, authenticated/);
  });
});

describe("server actions", () => {
  const actions = read(`${DASH}/lib/adminBusinessActions.ts`);

  for (const [fn, action] of [
    ["suspendBusiness", "suspend_business"],
    ["unsuspendBusiness", "unsuspend_business"],
    ["archiveBusiness", "archive_business"],
    ["restoreBusiness", "restore_business"],
  ]) {
    it(`${fn} checks the reason first and records ${action} with the reason`, () => {
      const body = fnBody(actions, fn);
      assert.ok(body.indexOf("requireReason(") >= 0 && body.indexOf("requireReason(") < body.indexOf("loadExisting("), fn);
      assert.match(body, new RegExp(`action: "${action}"`));
      assert.match(body, /\n\s+reason,\n/);
    });
  }

  it("archive stops billing through the existing billing-mode RPC, with a TODO hook for the rest", () => {
    assert.match(fnBody(actions, "archiveBusiness"), /stopBillingForArchive\(/);
    const stop = fnBody(actions, "stopBillingForArchive");
    assert.match(stop, /setTenantBillingMode\(\{ businessId: business\.id, mode: "off"/);
    assert.match(actions, /TODO\(ops-billing\)/);
  });

  it("the route takes every reason from the body and the actor from the session", () => {
    const route = read(`${DASH}/app/api/admin/businesses/route.ts`);
    for (const action of ["suspend", "unsuspend", "archive", "restore"]) {
      assert.match(route, new RegExp(`action === "${action}"`));
    }
    assert.match(route, /const actor = await adminActorName\(\)/);
    assert.doesNotMatch(route, /actor:\s*body\./);
  });
});

describe("screens", () => {
  const panel = read(`${DASH}/components/AdminBusinessesPanel.tsx`);

  it("archived businesses are hidden from the default list and have their own filter", () => {
    assert.match(panel, /filter === "all" \? b\.status === "archived"/);
    assert.match(panel, /key: "archived"/);
    assert.match(panel, /key: "suspended"/);
  });

  it("shows the purge date and the suspended line in plain words", () => {
    assert.match(panel, /`Purges on \$\{createdLabel\.format\(at\)\}`/);
    assert.match(panel, /"Suspended: line unavailable"/);
    assert.match(panel, /timeZone: "Africa\/Nairobi"/);
  });

  it("every lifecycle action needs the reason before Confirm is enabled", () => {
    assert.match(panel, /confirmDisabled=\{!reasonOk\(reason\)\}/);
  });

  it("no vendor or infra names in the new copy", () => {
    const { hasVendorOrInfraName } = require("../dashboard/src/lib/adminErrors.ts");
    // Sentence-like literals only (start with a capital, contain a space, no JSX).
    const strings = (panel.match(/"[A-Z][^"\n]{11,}"|`[^`\n]{12,}`/g) || []).filter((t) => / /.test(t) && !/[<=]/.test(t));
    // Interpolations are code (ARCHIVE_RESTORE_DAYS), not copy.
    for (const text of strings) assert.equal(hasVendorOrInfraName(text.replace(/\$\{[^}]*\}/g, "")), false, text);
    const closed = read(`${DASH}/components/WorkspaceClosed.tsx`);
    assert.equal(hasVendorOrInfraName(closed.replace(/import[^\n]+\n/g, "")), false);
  });

  it("an archived business blocks owner sign-in with a plain screen", () => {
    const layout = read(`${DASH}/app/(desk)/layout.tsx`);
    assert.ok(layout.indexOf("tenant?.archived") < layout.indexOf("tenantNeedsOnboarding(tenant)"));
    assert.match(layout, /<WorkspaceClosed/);
    assert.match(read(`${DASH}/app/onboarding/page.tsx`), /shell\?\.archived/);
    assert.match(read(`${DASH}/lib/tenant.ts`), /archived: deskLineState\(row\) === "closed"/);
  });
});

describe("purge SQL", () => {
  const sql = read("docs/supabase/purge_archived_tenants.sql");
  const schedule = read("docs/supabase/purge_archived_tenants_schedule.sql");

  it("defaults to a dry run and refuses a real run inside the restore window", () => {
    assert.match(sql, /p_dry_run boolean default true/);
    assert.match(sql, /a real purge needs p_days >= 30/);
  });

  it("only archived, inactive businesses are in scope", () => {
    assert.match(sql, /t\.archived_at is not null\s+and t\.is_active is false/);
  });

  it("keeps billing, usage, audit and the tenant row", () => {
    for (const keep of ["wallet_ledger", "tenant_subscriptions", "tenant_minute_grants", "notify_sends", "ops_audit_log"]) {
      assert.match(sql.slice(sql.indexOf("c_keep constant")), new RegExp(`'${keep}'`), keep);
    }
    const deletes = sql.slice(sql.indexOf("c_delete constant"), sql.indexOf("c_keep constant"));
    for (const keep of ["wallet_ledger", "ops_audit_log", "tenant_subscriptions"]) assert.doesNotMatch(deletes, new RegExp(`'${keep}'`));
    assert.doesNotMatch(sql, /delete from public\.tenants\b/);
  });

  it("deletes calls, contacts and playbook facts", () => {
    const deletes = sql.slice(sql.indexOf("c_delete constant"), sql.indexOf("c_keep constant"));
    for (const table of ["calls", "contacts", "caller_files", "tenant_field_meta", "tenant_field_history", "voice_turn_traces"]) {
      assert.match(deletes, new RegExp(`'${table}'`), table);
    }
  });

  it("never deletes call rows ahead of their recordings", () => {
    assert.match(sql, /action := 'blocked'/);
    assert.match(sql, /archived_tenant_recording_objects/);
  });

  it("is service-role only and audits real runs", () => {
    assert.match(sql, /grant execute on function public\.purge_archived_tenants\(integer, boolean, uuid\) to service_role/);
    assert.match(sql, /revoke all on function public\.purge_archived_tenants\(integer, boolean, uuid\) from public, anon, authenticated/);
    assert.match(sql, /'purge_business'/);
  });

  it("the schedule is a separate file that says it is not applied", () => {
    assert.doesNotMatch(sql, /cron\.schedule/);
    assert.match(schedule, /NOT APPLIED ANYWHERE/);
    assert.match(schedule, /purge_archived_tenants\(30, false\)/);
  });
});

"use strict";

// Hotfix B2: Admin "Grant minutes" always failed with 42702 and the Sheet
// showed "[object Object]". Guards the SQL shape and the error mapping.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(ROOT, "docs/supabase/fix_grant_package_minutes.sql");
const OPS = path.join(ROOT, "docs/supabase/admin_billing_ops.sql");
const helperPath = path.join(ROOT, "dashboard/src/lib/adminErrors.ts");
const panel = path.join(ROOT, "dashboard/src/components/AdminBillingDetailPanel.tsx");

function mapErrors(cases) {
  const script = `
    import { ADMIN_SETUP_INCOMPLETE, adminFacingError } from ${JSON.stringify(helperPath)};
    const cases = ${JSON.stringify(cases)};
    console.log(JSON.stringify({ fallback: ADMIN_SETUP_INCOMPLETE, out: cases.map((c) => adminFacingError(c)) }));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("grant package minutes hotfix", () => {
  it("qualifies every tenants column and resolves OUT-param conflicts to columns", () => {
    const sql = fs.readFileSync(FIX, "utf8").replace(/^\s*--.*$/gm, "");
    assert.match(sql, /#variable_conflict use_column/);
    assert.match(sql, /set minutes_included = coalesce\(t\.minutes_included, 0\) \+ v_minutes/);
    assert.doesNotMatch(sql, /coalesce\(minutes_included,/);
    assert.match(sql, /on conflict on constraint tenant_minute_grants_tenant_key_uniq do nothing/);
    assert.match(sql, /for update;/);
    assert.match(sql, /'period_start', v_start/);
  });

  it("admin_billing_ops.sql no longer carries the broken grant body", () => {
    const sql = fs.readFileSync(OPS, "utf8");
    assert.doesNotMatch(sql, /create or replace function public\.grant_tenant_package_minutes/);
  });

  it("maps PostgREST error objects to plain text, never [object Object]", () => {
    const { fallback, out } = mapErrors([
      { message: 'column reference "minutes_included" is ambiguous', code: "42702", details: null, hint: null },
      { message: "tenant not found", code: "P0001", details: null, hint: null },
      { details: null, hint: null },
      { message: "minutes must be between 1 and 100000", code: "P0001" },
      { message: "JWT expired", code: "PGRST301" },
    ]);
    assert.deepEqual(out, [
      fallback,
      "Tenant not found",
      fallback,
      "Minutes must be between 1 and 100000",
      fallback,
    ]);
    for (const text of out) assert.notEqual(text, "[object Object]");
  });

  it("reuses one idempotency key per open grant Sheet", () => {
    const src = fs.readFileSync(panel, "utf8");
    assert.match(src, /idempotency_key: grantKey/);
    assert.doesNotMatch(src, /idempotency_key: crypto\.randomUUID\(\)/);
  });
});

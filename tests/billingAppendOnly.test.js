// tenant_minute_grants and ops_audit_log are append-only (migration 20261031030000).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261031030000_billing_append_only_grants_audit.sql", "utf8");

describe("append-only grants and ops audit", () => {
  it("blocks update, delete and truncate on both tables", () => {
    for (const t of ["tenant_minute_grants", "ops_audit_log"]) {
      assert.match(sql, new RegExp(`before update or delete on public\\.${t}\\s+for each row`));
      assert.match(sql, new RegExp(`before truncate on public\\.${t}\\s+for each statement`));
    }
  });
  it("lets only a business removal through, and only as the FK action", () => {
    assert.match(sql, /current_setting\('scalers\.billing_purge', true\) = '1'/);
    assert.match(sql, /to_jsonb\(new\) - 'tenant_id'\) = \(to_jsonb\(old\) - 'tenant_id'\)/);
  });
  it("takes ops_audit_log away from anon and authenticated", () => {
    assert.match(sql, /revoke all on table public\.ops_audit_log from anon, authenticated;/);
  });
  it("no app code updates or deletes either table", () => {
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(p);
      }
    };
    walk("dashboard/src");
    walk("src");
    const bad = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /from\(["'](tenant_minute_grants|ops_audit_log)["']\)\s*\.(update|delete|upsert)\(/.test(s)
        || /(update|delete\s+from)\s+(public\.)?(tenant_minute_grants|ops_audit_log)\b/i.test(s);
    });
    assert.deepEqual(bad, []);
  });
});

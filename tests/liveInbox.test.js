// Live Inbox: realtime subscription, debounced server refresh, graceful degradation.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("LiveInbox component", () => {
  const src = read("dashboard/src/components/LiveInbox.tsx");

  it("is a silent client component", () => {
    assert.match(src, /"use client"/);
    assert.match(src, /export function LiveInbox\(\{ tenantId \}: \{ tenantId: string \}\)/);
    assert.match(src, /return null;/);
  });

  it("subscribes to the three work tables, scoped to the tenant", () => {
    for (const table of ["calls", "service_requests", "appointments"]) {
      assert.ok(src.includes(`"${table}"`), `subscribes to ${table}`);
    }
    assert.match(src, /postgres_changes/);
    assert.match(src, /tenant_id=eq\.\$\{tenantId\}/);
  });

  it("debounces bursts into one server refresh and cleans up", () => {
    assert.match(src, /REFRESH_DEBOUNCE_MS = 1200/);
    assert.match(src, /clearTimeout\(timer\.current\)/);
    assert.match(src, /router\.refresh\(\)/);
    assert.match(src, /removeChannel\(channel\)/);
  });

  it("degrades to refresh-to-update when the browser client cannot start", () => {
    assert.match(src, /try \{\s*supabase = createSupabaseBrowserClient\(\);\s*\} catch \{\s*return;/);
  });
});

describe("LiveInbox wiring", () => {
  it("renders on the Inbox and Home pages with the tenant id", () => {
    const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    for (const [name, src] of [
      ["calls", calls],
      ["home", home],
    ]) {
      assert.match(src, /import \{ LiveInbox \} from "@\/components\/LiveInbox";/, `${name} imports LiveInbox`);
      assert.match(src, /<LiveInbox tenantId=\{tenant\.id\} \/>/, `${name} renders LiveInbox`);
    }
  });
});

describe("realtime publication script", () => {
  const sql = read("docs/supabase/realtime_inbox.sql");

  it("publishes exactly the three work tables", () => {
    for (const table of ["calls", "service_requests", "appointments"]) {
      assert.ok(sql.includes(`'${table}'`), `publishes ${table}`);
    }
    assert.match(sql, /alter publication supabase_realtime add table/i);
  });

  it("is additive and idempotent (no drops, guards on existing membership)", () => {
    assert.match(sql, /if not exists/i);
    assert.doesNotMatch(sql, /\bdrop\b/i);
    assert.doesNotMatch(sql, /\bdelete\b/i);
  });

  it("is recorded in the SQL index and migration ledger", () => {
    assert.match(read("docs/supabase/README.md"), /realtime_inbox\.sql/);
    assert.match(read("docs/supabase/MIGRATION_LEDGER.md"), /realtime_inbox\.sql/);
  });
});

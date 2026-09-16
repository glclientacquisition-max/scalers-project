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

  it("waits for an owner session before subscribe", () => {
    assert.match(src, /auth\.getSession\(\)/);
    assert.match(src, /if \(cancelled \|\| !data\.session\) return;/);
  });

  it("debounces bursts into one server refresh and cleans up", () => {
    assert.match(src, /REFRESH_DEBOUNCE_MS = 1200/);
    assert.match(src, /clearTimeout\(timer\.current\)/);
    assert.match(src, /routerRef\.current\.refresh\(\)/);
    assert.match(src, /removeChannel\(channel\)/);
    assert.doesNotMatch(src, /\[tenantId, router\]/);
  });

  it("revalidates Inbox and Home then refreshes, including when the tab returns", () => {
    assert.match(src, /revalidateLiveDesk/);
    assert.match(src, /visibilitychange/);
    assert.match(src, /addEventListener\("focus"/);
  });

  it("degrades to refresh-to-update when the browser client cannot start", () => {
    assert.match(src, /try \{\s*supabase = createSupabaseBrowserClient\(\);\s*\} catch \{\s*return;/);
  });
});

describe("LiveInbox wiring", () => {
  it("renders once in the desk shell with the tenant id", () => {
    const layout = read("dashboard/src/app/(desk)/layout.tsx");
    assert.match(layout, /import \{ LiveInbox \} from "@\/components\/LiveInbox";/);
    assert.match(layout, /<LiveInbox tenantId=\{tenant\.id\} \/>/);
  });

  it("does not remount on Inbox or Home pages", () => {
    const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    assert.doesNotMatch(calls, /LiveInbox/);
    assert.doesNotMatch(home, /LiveInbox/);
  });
});

describe("live desk revalidation", () => {
  const src = read("dashboard/src/app/(desk)/liveInboxActions.ts");

  it("is a server action that drops Inbox and Home caches", () => {
    assert.match(src, /"use server"/);
    assert.match(src, /export async function revalidateLiveDesk/);
    assert.match(src, /revalidatePath\("\/home"\)/);
    assert.match(src, /revalidatePath\("\/calls", "layout"\)/);
    assert.match(src, /revalidatePath\("\/contacts", "layout"\)/);
    assert.match(src, /isAuthenticated\(\)/);
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

describe("realtime replica identity script", () => {
  const sql = read("docs/supabase/realtime_inbox_replica_identity.sql");

  it("sets FULL replica identity on the three work tables", () => {
    for (const table of ["calls", "service_requests", "appointments"]) {
      assert.match(
        sql,
        new RegExp(`alter table public\\.${table} replica identity full`, "i"),
        `FULL identity on ${table}`
      );
    }
  });

  it("is additive (no drops or policy changes)", () => {
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert.doesNotMatch(statements, /\bdrop\b/i);
    assert.doesNotMatch(statements, /\bdelete\b/i);
    assert.doesNotMatch(statements, /\bpolicy\b/i);
    assert.match(statements, /replica identity full/i);
  });

  it("is recorded in the SQL index and migration ledger", () => {
    assert.match(read("docs/supabase/README.md"), /realtime_inbox_replica_identity\.sql/);
    assert.match(read("docs/supabase/MIGRATION_LEDGER.md"), /realtime_inbox_replica_identity\.sql/);
  });
});

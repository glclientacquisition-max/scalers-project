/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/teamScale.test.ts */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { LIMITS, PAGE_MAX, isFreshDuplicate, pageLimit, rateLimitMessage } from "../dashboard/src/lib/teamLimits.ts";

// Works under plain node (ESM, --experimental-strip-types) and tsx alike.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const read = (p: string) => fs.readFileSync(path.join(TEST_DIR, "..", p), "utf8");
const actions = read("dashboard/src/app/(desk)/settings/membersActions.ts");
const load = read("dashboard/src/lib/membersLoad.ts");
const panel = read("dashboard/src/components/MembersPanel.tsx");
const mig = read("supabase/migrations/20261011140000_team_scale.sql");
const fn = (name: string) => actions.slice(actions.indexOf(`export async function ${name}`)).split("\nexport async function")[0];

describe("pagination", () => {
  it("page limits snap to page size and cap", () => {
    assert.equal(pageLimit(undefined, 50), 50);
    assert.equal(pageLimit("abc", 50), 50);
    assert.equal(pageLimit("-5", 50), 50);
    assert.equal(pageLimit("51", 50), 100);
    assert.equal(pageLimit("100", 50), 100);
    assert.equal(pageLimit("99999", 50), PAGE_MAX);
  });
  it("members load in one directory query (no per-member auth lookups) and invites are limited + counted", () => {
    assert.match(load, /rpc\("tenant_member_directory"/);
    assert.doesNotMatch(load, /getUserById/);
    assert.match(load, /count: "exact"/);
    assert.match(load, /\.limit\(inviteLimit\)/);
    assert.match(load, /\.gt\("expires_at", nowIso\)/);
  });
  it("panel offers Show more for both lists", () => {
    assert.match(panel, /moreHref\("members"/);
    assert.match(panel, /moreHref\("invites"/);
  });
});

describe("rate limits", () => {
  it("messages for each limit, null under limits", () => {
    assert.equal(rateLimitMessage({ workspace: 0, actor: 0 }, "invite"), null);
    assert.match(rateLimitMessage({ workspace: LIMITS.workspacePerHour, actor: 0 }, "invite")!, /This business/);
    assert.match(rateLimitMessage({ workspace: 0, actor: LIMITS.actorPerHour }, "invite")!, /You've sent/);
    assert.match(rateLimitMessage({ workspace: 0, actor: 0, invite: LIMITS.resendPerInvitePerHour }, "resend")!, /resent 3 times/);
    assert.equal(rateLimitMessage({ workspace: 0, actor: 0, invite: 99 }, "invite"), null);
  });
  it("invite and resend check DB-backed counts (shared across instances), no in-memory map", () => {
    assert.doesNotMatch(actions, /new Map</);
    assert.match(fn("inviteMemberAction"), /rateLimitMessage\(await recentInviteCounts\(ctx\.tenantId, ctx\.userId\), "invite"\)/);
    assert.match(fn("resendInviteAction"), /rateLimitMessage\(await recentInviteCounts\(ctx\.tenantId, ctx\.userId, row\.email\), "resend"\)/);
    assert.match(actions, /from\("tenant_member_audit"\)[\s\S]*?\.in\("action", \["invite", "resend"\]\)/);
  });
});

describe("idempotency", () => {
  it("fresh duplicate from same actor counts as success", () => {
    const now = Date.parse("2026-10-11T10:00:30Z");
    assert.equal(isFreshDuplicate("2026-10-11T10:00:00Z", "u1", "u1", now), true);
    assert.equal(isFreshDuplicate("2026-10-11T09:50:00Z", "u1", "u1", now), false);
    assert.equal(isFreshDuplicate("2026-10-11T10:00:00Z", "u2", "u1", now), false);
    assert.equal(isFreshDuplicate(null, "u1", "u1", now), false);
  });
  it("repeat calls are no-op successes", () => {
    assert.match(fn("inviteMemberAction"), /isFreshDuplicate\(/);
    assert.match(fn("revokeInviteAction"), /=== "revoked"\) return \{ ok: true/);
    assert.match(fn("changeMemberRoleAction"), /current === next\) return \{ ok: true/);
    assert.match(fn("removeMemberAction"), /if \(!current\) return \{ ok: true/);
  });
  it("client runs one action at a time", () => {
    assert.match(panel, /if \(busy\.current\) return;/);
  });
});

describe("migration", () => {
  it("indexes, directory and expiry function are service-role only", () => {
    for (const idx of ["tenant_members_tenant_created_idx", "tenant_invites_pending_tenant_idx", "tenant_invites_pending_email_idx", "tenant_invites_pending_expiry_idx", "tenant_member_audit_rate_idx"]) {
      assert.match(mig, new RegExp(`create index if not exists ${idx}`));
    }
    assert.match(mig, /revoke all on function public\.tenant_member_directory\(uuid, int, int\) from public, anon, authenticated/);
    assert.match(mig, /revoke all on function public\.expire_stale_tenant_invites\(\) from public, anon, authenticated/);
    assert.match(mig, /set status = 'expired'\s+where status = 'pending' and expires_at < now\(\)/);
    assert.match(mig, /set search_path = ''/);
  });
});

it("alert contact chevron points up when the row is open", () => {
  const ac = read("dashboard/src/components/AlertContactsList.tsx");
  assert.match(ac, /expanded \? \(\s*<ChevronUpIcon/);
});

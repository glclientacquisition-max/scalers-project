/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/permissions.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { ACTIONS, assignableRoles, can, canManageMember, normalizeRole, type Action, type Role } from "../dashboard/src/lib/permissions.ts";
import { teamInvitesEnabled } from "../dashboard/src/lib/teamInvitesFlag.ts";

const EXPECT: Record<Role, Action[]> = {
  owner: [...ACTIONS],
  admin: ACTIONS.filter((a) => a !== "ownership.transfer"),
  staff: ["overview.view", "inbox.view", "inbox.act", "contacts.view", "contacts.edit"],
  viewer: ["overview.view", "inbox.view", "contacts.view", "settings.view"],
};

it("permission matrix matches the approved design", () => {
  for (const role of Object.keys(EXPECT) as Role[]) {
    for (const action of ACTIONS) {
      assert.equal(can(role, action), EXPECT[role].includes(action), `${role} ${action}`);
    }
  }
});
it("admin can top up / change package; staff cannot see usage or billing", () => {
  assert.equal(can("admin", "billing.manage"), true);
  assert.equal(can("staff", "usage.view"), false);
  assert.equal(can("staff", "billing.manage"), false);
  assert.equal(can("viewer", "inbox.act"), false);
  assert.equal(can(null, "overview.view"), false);
});
it("legacy member maps to staff, unknown to viewer", () => {
  assert.equal(normalizeRole("member"), "staff");
  assert.equal(normalizeRole("superuser"), "viewer");
  assert.equal(normalizeRole("ADMIN"), "admin");
});
it("owner protection in role management", () => {
  assert.deepEqual(assignableRoles("owner"), ["admin", "staff", "viewer"]);
  assert.deepEqual(assignableRoles("admin"), ["staff", "viewer"]);
  assert.deepEqual(assignableRoles("staff"), []);
  assert.equal(canManageMember("owner", "owner"), false);
  assert.equal(canManageMember("admin", "admin"), false);
  assert.equal(canManageMember("admin", "staff"), true);
});
it("feature flag defaults off; env or tenant list enables", () => {
  assert.equal(teamInvitesEnabled("t1", {} as NodeJS.ProcessEnv), false);
  assert.equal(teamInvitesEnabled("t1", { TEAM_INVITES_ENABLED: "true" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(teamInvitesEnabled("t1", { TEAM_INVITES_TENANTS: "t0, t1" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(teamInvitesEnabled("t2", { TEAM_INVITES_TENANTS: "t0,t1" } as unknown as NodeJS.ProcessEnv), false);
});

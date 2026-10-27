/**
 * previewDeskLookupAction role gate: read only, so every member role may run it (owner, admin,
 * staff, viewer), and a closed business is still refused first (memberDenied).
 * Run: node --experimental-strip-types --import ./tests/serverOnlyHook.mjs --test tests/previewDeskLookupRoles.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { can, ROLES, type Action } from "../dashboard/src/lib/permissions.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.join(TEST_DIR, "..", "dashboard", "src", "app", "(desk)", "settings", "assistantSayActions.ts"),
  "utf8"
);

function gateOf(fn: string, firstWork?: string): Action {
  const start = SRC.indexOf(`export async function ${fn}(`);
  assert.ok(start >= 0, `${fn} exists`);
  const body = SRC.slice(start, SRC.indexOf("\n}\n", start));
  const m = body.match(/const denied = await memberDenied\("([a-z.]+)"\);\s*if \(denied\)/);
  assert.ok(m, `${fn} checks memberDenied first`);
  // The guard is the first statement, before any lookup work.
  if (firstWork) assert.ok(body.indexOf("memberDenied(") < body.indexOf(firstWork), `${fn} guards before work`);
  return m[1] as Action;
}

describe("previewDeskLookupAction role gate", () => {
  const perm = gateOf("previewDeskLookupAction", "deskLookupPreview()");

  it("uses the shared read permission (overview.view)", () => {
    assert.equal(perm, "overview.view");
  });

  const expected: Record<(typeof ROLES)[number], boolean> = { owner: true, admin: true, staff: true, viewer: true };
  for (const role of ROLES) {
    it(`${role} may preview`, () => {
      assert.equal(can(role, perm), expected[role]);
    });
  }

  it("staff are allowed whenever viewers are", () => {
    assert.ok(!can("viewer", perm) || can("staff", perm));
  });

  it("saving what it will say stays settings.edit (owner and admin only)", () => {
    const save = gateOf("saveUnknownAnswerByKindAction");
    assert.equal(save, "settings.edit");
    assert.deepEqual(ROLES.filter((r) => can(r, save)), ["owner", "admin"]);
  });
});

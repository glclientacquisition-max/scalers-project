/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/ownershipTransfer.test.ts */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { transferConfirmMatches } from "../dashboard/src/lib/memberConfirm.ts";

// Works under plain node (ESM, --experimental-strip-types) and tsx alike.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const read = (p: string) => fs.readFileSync(path.join(TEST_DIR, "..", p), "utf8");
const panel = read("dashboard/src/components/MembersPanel.tsx");
const actions = read("dashboard/src/app/(desk)/settings/membersActions.ts");

it("typed confirmation must match the new owner's email", () => {
  assert.equal(transferConfirmMatches("Scalers.com@gmail.com ", "scalers.com@gmail.com"), true);
  assert.equal(transferConfirmMatches("scalers.com", "scalers.com@gmail.com"), false);
  assert.equal(transferConfirmMatches("", ""), false);
});

it("no window.confirm; transfer uses the in-app ConfirmSheet with consequences + typed email", () => {
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.match(panel, /<ConfirmSheet/);
  assert.match(panel, /typeToConfirm: m\.email/);
  assert.match(panel, /You become an Admin\. You keep the inbox/);
  assert.match(panel, /You can no longer transfer ownership/);
  assert.match(panel, /holds the account and its billing/);
  assert.match(panel, /confirmDisabled=\{!!confirming\?\.typeToConfirm && !transferConfirmMatches/);
});

it("every outcome is surfaced: inline flash + desk toast, thrown errors caught, refresh after transfer", () => {
  assert.match(panel, /setFlash\(result\);\s*notify\(result\.error \|\| result\.message/);
  assert.match(panel, /catch \{\s*result = \{ error: "Something went wrong\. Nothing was changed/);
  assert.match(panel, /if \(opts\?\.refreshAll\) router\.refresh\(\)/);
  assert.match(panel, /refreshAll: true,\s*fn: \(\) => transferOwnershipAction\(m\.userId\)/);
});

it("server action: owner-only guard, validates target, uses the atomic RPC, returns a message", () => {
  const body = actions.slice(actions.indexOf("export async function transferOwnershipAction"));
  assert.match(body, /memberDenied\("ownership\.transfer"\)/);
  assert.match(body, /You're already the owner/);
  assert.match(body, /rpc\("transfer_tenant_ownership", \{\s*p_tenant: ctx\.tenantId,\s*p_actor: ctx\.userId,\s*p_new_owner: target/);
  assert.match(body, /Ownership transferred\. You're now an Admin\./);
});

it("RPC demotes the old owner before promoting the new one (one-owner index safe)", () => {
  const sql = read("supabase/migrations/20261011000000_team_invites.sql");
  const fn = sql.slice(sql.indexOf("function public.transfer_tenant_ownership"));
  assert.ok(fn.indexOf("set role = 'admin'") < fn.indexOf("set role = 'owner'"));
  assert.match(fn, /raise exception 'forbidden'/);
  assert.match(fn, /raise exception 'target_not_admin'/);
});

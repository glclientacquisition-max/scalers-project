/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/createWorkspace.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseCreateWorkspaceInput } from "../dashboard/src/lib/createWorkspace.ts";

it("normalizes Kenyan phone and trims name", () => {
  assert.deepEqual(parseCreateWorkspaceInput({ businessName: " Aris ", notificationPhone: "0712 345 678" }), {
    ok: true, businessName: "Aris", notificationPhone: "+254712345678",
  });
});
it("rejects empty name and bad phone", () => {
  assert.equal(parseCreateWorkspaceInput({ businessName: "", notificationPhone: "0712345678" }).ok, false);
  assert.equal(parseCreateWorkspaceInput({ businessName: "A", notificationPhone: "abc" }).ok, false);
  assert.equal(parseCreateWorkspaceInput({ businessName: "A", notificationPhone: "12345" }).ok, false);
});

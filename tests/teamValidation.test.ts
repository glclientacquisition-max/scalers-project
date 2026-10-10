/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/teamValidation.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { normalizeContactPhone, validateTeamSave } from "../dashboard/src/lib/teamValidation.ts";

const owner = { name: "Owner", role: "", phone: "+254712345678" };

it("normalizes phones to E.164 and rejects junk", () => {
  assert.equal(normalizeContactPhone("0712 345 678"), "+254712345678");
  assert.equal(normalizeContactPhone("254712345678"), "+254712345678");
  assert.equal(normalizeContactPhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizeContactPhone("abc"), null);
  assert.equal(normalizeContactPhone("12345"), null);
});

it("returns a visible error for a bad email instead of failing silently", () => {
  const r = validateTeamSave({ submitted: [owner, { name: "Jo", phone: "0722000000", email: "jo@" }], stored: [owner] });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /not a valid email/);
});

it("rejects nameless and duplicate teammates", () => {
  assert.equal(validateTeamSave({ submitted: [owner, { name: "", phone: "0722000000" }], stored: [] }).ok, false);
  assert.equal(validateTeamSave({ submitted: [owner, { name: "Dup", phone: "0712345678" }], stored: [] }).ok, false);
});

it("blocks removing the owner", () => {
  const r = validateTeamSave({ submitted: [{ name: "Jo", phone: "0722000000" }], stored: [owner], ownerPhone: "0712345678" });
  assert.equal(r.ok, false);
});

it("enforces the seat limit on growth only", () => {
  const four = [owner, ...[1, 2, 3].map((i) => ({ name: `T${i}`, phone: `072200000${i}` }))];
  const six = [...four, { name: "T4", phone: "0722000004" }, { name: "T5", phone: "0722000005" }];
  assert.equal(validateTeamSave({ submitted: six, stored: four, seatLimit: 4 }).ok, false);
  assert.equal(validateTeamSave({ submitted: four, stored: four, seatLimit: 4 }).ok, true);
  assert.equal(validateTeamSave({ submitted: six, stored: six, seatLimit: 4 }).ok, true);
});

it("ignores blank rows and normalizes stored phones", () => {
  const r = validateTeamSave({ submitted: [owner, { name: "", phone: "", email: "", role: "" }], stored: [] });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.rows.length, 1);
});

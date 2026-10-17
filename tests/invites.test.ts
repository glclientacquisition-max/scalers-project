/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/invites.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  daysLeft,
  generateInviteToken,
  hashInviteToken,
  inviteEmail,
  inviteErrorCopy,
  inviteState,
  normalizeInviteEmail,
  seatSummary,
} from "../dashboard/src/lib/invites.ts";

const now = new Date("2026-10-11T00:00:00Z");
const future = "2026-10-15T00:00:00Z";
const past = "2026-10-10T00:00:00Z";

it("tokens are random and only a sha256 hash is stored", () => {
  const a = generateInviteToken();
  assert.notEqual(a, generateInviteToken());
  assert.ok(a.length >= 40);
  assert.match(hashInviteToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashInviteToken(a), hashInviteToken(` ${a} `));
});
it("expiry", () => {
  assert.equal(inviteState({ status: "pending", expires_at: future }, now), "pending");
  assert.equal(inviteState({ status: "pending", expires_at: past }, now), "expired");
  assert.equal(inviteState({ status: "revoked", expires_at: future }, now), "revoked");
  assert.equal(daysLeft(future, now), 4);
});
it("seats count owner + members + pending (unexpired) invites", () => {
  const s = seatSummary({
    members: 1,
    invites: [{ status: "pending", expires_at: future }, { status: "pending", expires_at: past }, { status: "revoked", expires_at: future }],
    included: 2,
    now,
  });
  assert.deepEqual(s, { used: 2, included: 2, full: true, members: 1, pending: 1 });
  assert.equal(seatSummary({ members: 1, invites: [], included: 1, now }).full, true); // "Seats 1/1"
  assert.equal(seatSummary({ members: 1, invites: [], included: 5, now }).full, false);
});
it("maps RPC errors to owner copy", () => {
  assert.match(inviteErrorCopy('P0001: seats_full'), /Upgrade/);
  assert.match(inviteErrorCopy("email_mismatch"), /different email/);
  assert.match(inviteErrorCopy("expired"), /expired/);
  assert.match(inviteErrorCopy("weird"), /Something went wrong/);
});
it("email template escapes business name and includes link + role", () => {
  const m = inviteEmail({ businessName: "A&B <Shop>", role: "staff", link: "https://app.example/invite/x" });
  assert.match(m.text, /as Staff/);
  assert.match(m.text, /https:\/\/app\.example\/invite\/x/);
  assert.match(m.html, /A&amp;B &lt;Shop&gt;/);
  assert.match(m.text, /expires in 7 days/);
});
it("normalizes invite email", () => {
  assert.equal(normalizeInviteEmail(" Jo@Shop.co.ke "), "jo@shop.co.ke");
  assert.equal(normalizeInviteEmail("jo@"), null);
});

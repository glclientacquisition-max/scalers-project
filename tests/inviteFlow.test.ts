/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/inviteFlow.test.ts */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import {
  inviteConfirmUrl,
  inviteTokenFromNext,
  originFromHeaders,
  rootAuthForward,
  safeNextPath,
  welcomeHomePath,
} from "../dashboard/src/lib/authRedirect.ts";
import { expiryLabel, invitePageKind } from "../dashboard/src/lib/invitePageState.ts";

// Works under plain node (ESM, --experimental-strip-types) and tsx alike.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(TEST_DIR, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

it("safeNextPath only allows same-site relative paths", () => {
  assert.equal(safeNextPath("/invite/abc"), "/invite/abc");
  assert.equal(safeNextPath("https://evil.com"), "/home");
  assert.equal(safeNextPath("//evil.com"), "/home");
  assert.equal(safeNextPath("/\\evil.com"), "/home");
  assert.equal(safeNextPath(null), "/home");
  assert.equal(safeNextPath("/a\nb"), "/home");
});

it("confirmation link returns through /auth/confirm to the invite", () => {
  const url = inviteConfirmUrl("https://scalers-staging.vercel.app/", "tok_123-xyz");
  assert.equal(url, "https://scalers-staging.vercel.app/auth/confirm?next=%2Finvite%2Ftok_123-xyz");
  const next = safeNextPath(new URL(url).searchParams.get("next"));
  assert.equal(inviteTokenFromNext(next), "tok_123-xyz");
  assert.equal(inviteTokenFromNext("/home"), null);
});

it("origin comes from the request host, not a hard-coded site URL", () => {
  const h = (m: Record<string, string>) => (k: string) => m[k] ?? null;
  assert.equal(originFromHeaders(h({ "x-forwarded-host": "scalers-staging.vercel.app", "x-forwarded-proto": "https" }), "x"), "https://scalers-staging.vercel.app");
  assert.equal(originFromHeaders(h({ host: "localhost:3020" }), "x"), "http://localhost:3020");
  assert.equal(originFromHeaders(h({}), "app.scalers.co.ke"), "https://app.scalers.co.ke");
});

it("root landing with ?code= (Supabase fallback) is forwarded to /auth/confirm", () => {
  assert.equal(rootAuthForward("/", new URLSearchParams("code=abc")), "/auth/confirm?code=abc&next=%2Fhome");
  assert.equal(rootAuthForward("/", new URLSearchParams("token_hash=h&type=signup")), "/auth/confirm?token_hash=h&type=signup&next=%2Fhome");
  assert.equal(rootAuthForward("/", new URLSearchParams("")), null);
  assert.equal(rootAuthForward("/login", new URLSearchParams("code=abc")), null);
});

it("welcome path carries the business name for the toast", () => {
  assert.equal(welcomeHomePath("Done & Dusted"), "/home?welcome=Done%20%26%20Dusted");
});

it("invite page picks exactly one path per state", () => {
  const base = { found: true, enabled: true, state: "pending" as const, inviteEmail: "a@b.co" };
  assert.equal(invitePageKind({ found: false, enabled: true }), "invalid");
  assert.equal(invitePageKind({ ...base, enabled: false }), "invalid");
  assert.equal(invitePageKind({ ...base, hasAccount: false }), "signup");
  assert.equal(invitePageKind({ ...base, hasAccount: true }), "signin");
  assert.equal(invitePageKind({ ...base, signedInEmail: "A@B.co" }), "accept");
  assert.equal(invitePageKind({ ...base, signedInEmail: "other@b.co" }), "wrong_account");
  assert.equal(invitePageKind({ ...base, state: "expired" }), "expired");
  assert.equal(invitePageKind({ ...base, state: "revoked" }), "revoked");
  assert.equal(invitePageKind({ ...base, state: "accepted" }), "accepted");
  assert.equal(invitePageKind({ ...base, state: "accepted", signedInEmail: "a@b.co", isMember: true }), "accepted_self");
});

it("expiry label", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  assert.equal(expiryLabel("2026-10-18T00:00:00Z", now), "Expires in 7 days");
  assert.equal(expiryLabel("2026-10-12T05:00:00Z", now), "Expires tomorrow");
  assert.equal(expiryLabel("2026-10-11T03:30:00Z", now), "Expires in 4 hours");
  assert.equal(expiryLabel("2026-10-10T00:00:00Z", now), "This invite has expired");
});

it("wiring: signup redirects via /auth/confirm, login and confirm finish pending invites", () => {
  const actions = read("dashboard/src/app/invite/[token]/actions.ts");
  assert.match(actions, /emailRedirectTo: inviteConfirmUrl\(origin, token\)/);
  assert.doesNotMatch(actions, /emailRedirectTo: `https:\/\/\$\{configuredAppHost\(\)\}\/invite/);
  assert.match(read("dashboard/src/app/api/login/route.ts"), /acceptPendingInvitesForUser\(data\.user\)/);
  const confirm = read("dashboard/src/app/auth/confirm/route.ts");
  assert.match(confirm, /exchangeCodeForSession/);
  assert.match(confirm, /verifyOtp/);
  assert.match(confirm, /acceptByToken\(inviteToken, userId\)/);
  assert.match(read("dashboard/src/proxy.ts"), /rootAuthForward\(path, request\.nextUrl\.searchParams\)/);
  const logout = read("dashboard/src/app/api/logout/route.ts");
  assert.match(logout, /inviteTokenFromNext\(want\)/);
});

it("team form refuses existing members and pending invites with a clear message", () => {
  const m = read("dashboard/src/app/(desk)/settings/membersActions.ts");
  assert.match(m, /is already on this team/);
  assert.match(m, /already has a pending invite/);
  const sql = read("supabase/migrations/20261011000000_team_invites.sql");
  assert.match(sql, /raise exception 'already_member'/);
  assert.match(sql, /raise exception 'already_invited'/);
});

it("account lookup migration is service-role only and additive", () => {
  const sql = read("supabase/migrations/20261011120000_invite_account_lookup.sql");
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.invite_email_has_account\(text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.invite_email_has_account\(text\) to service_role/);
  assert.doesNotMatch(sql, /drop |truncate|delete from/i);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");

// Each sequential Supabase round trip costs the region gap (~80 ms iad1 -> London, ~2 ms lhr1).
test("inbox loader: calls tape, holds and jobs go out in one round trip", () => {
  const inbox = src("lib/inboxLoad.ts");
  assert.match(inbox, /await Promise\.all\(\[fetchCallsTape\(client, tenantId\), workPromise\]\)/);
  assert.doesNotMatch(inbox, /const callsRes = await fetchCallsTape/);
});

test("desk session is verified locally (getClaims), onboarding keeps the full getUser", () => {
  const auth = src("lib/auth.ts");
  assert.match(auth, /getClaims/);
  assert.match(auth, /export const getVerifiedAuthUser/);
  assert.match(src("lib/setupServer.ts"), /getVerifiedAuthUser as getAuthUser/);
});

test("tenant row is cached per tenant with a tag, and every tenants write busts it", () => {
  const tenant = src("lib/tenant.ts");
  assert.match(tenant, /"use cache";\s*\n\s*cacheTag\(tenantCacheTag\(tenantId\)\)/);
  assert.match(src("lib/tenantCache.ts"), /`tenant:\$\{tenantId\}`/);
  for (const f of [
    "app/(desk)/settings/actions.ts",
    "app/(desk)/settings/structuredActions.ts",
    "app/api/tenant/route.ts",
    "app/onboarding/setupActions.ts",
    "lib/catalogImportRecompile.ts",
    "lib/adminBusinessActions.ts",
  ]) {
    assert.match(src(f), /bustTenantCache\(/, f);
  }
});

test("every desk tab has a loading skeleton and the router cache is on", () => {
  for (const tab of ["home", "calls", "contacts", "requests", "appointments", "wallet", "settings"]) {
    assert.ok(existsSync(new URL(`../dashboard/src/app/(desk)/${tab}/loading.tsx`, import.meta.url)), tab);
  }
  assert.match(readFileSync(new URL("../dashboard/next.config.ts", import.meta.url), "utf8"), /staleTimes:\s*\{\s*dynamic:\s*30/);
  assert.deepEqual(JSON.parse(readFileSync(new URL("../dashboard/vercel.json", import.meta.url), "utf8")).regions, ["lhr1"]);
});

/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/marketingLinks.test.ts */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { it } from "node:test";
import { appEntryHref } from "../dashboard/src/lib/adminHost.ts";

it("app entry links are absolute when site and app hosts are split", () => {
  const env = { APP_HOST: "app.scalers.co.ke", SITE_HOST: "www.scalers.co.ke" } as unknown as NodeJS.ProcessEnv;
  assert.equal(appEntryHref("/login", env), "https://app.scalers.co.ke/login");
  const same = { APP_HOST: "localhost:3000", SITE_HOST: "localhost:3000" } as unknown as NodeJS.ProcessEnv;
  assert.equal(appEntryHref("/signup", same), "/signup");
});
it("landing page does not prefetch app routes with next/link", () => {
  const src = readFileSync("dashboard/src/components/marketing/LandingPage.tsx", "utf8");
  assert.doesNotMatch(src, /from "next\/link"/);
  assert.match(src, /appEntryHref\("\/login"\)/);
});
it("/pricing exists, says Free beta, shows no KES prices", () => {
  const p = "dashboard/src/app/pricing/page.tsx";
  assert.ok(existsSync(p));
  const src = readFileSync(p, "utf8");
  assert.match(src, /Free beta/);
  assert.doesNotMatch(src, /KES|KSh|\d{3,}/);
});

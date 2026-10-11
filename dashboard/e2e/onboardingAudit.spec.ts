import { AxeBuilder } from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Charter §8 gate for onboarding + team invites: axe (all impacts) + full-page screenshot per width.
 *   AUDIT_SET=public  E2E_BASE_URL=https://scalers-staging.vercel.app  (signup, login link states, marketing)
 *   AUDIT_SET=fixtures (local next dev with DASHBOARD_OPEN=true: setup steps, finishing, number, invite, Team)
 * Results append to $AUDIT_OUT/results.jsonl; screenshots go to $AUDIT_OUT/<project>/<name>.png.
 */
const OUT = process.env.AUDIT_OUT || "/workspace/screens/final";
const SET = process.env.AUDIT_SET || "fixtures";

const PUBLIC = [
  ["marketing", "/"],
  ["signup", "/signup"],
  ["login", "/login"],
  ["login-link-confirmed", "/login?link=confirmed"],
  ["login-link-expired", "/login?link=expired"],
  ["login-error", "/login?error=1"],
] as const;

const steps = ["business", "catalogue", "hours", "voice", "faqs", "alerts"];
const FIXTURES: Array<readonly [string, string]> = [
  ...steps.map((s) => [`setup-shop-${s}`, `/dev/setup?step=${s}`] as const),
  ...["business", "catalogue", "faqs"].map((s) => [`setup-home-${s}`, `/dev/setup?step=${s}&vertical=home_services`] as const),
  ["setup-finishing", "/dev/setup/finishing"],
  ["number-assigned", "/dev/setup/line"],
  ["number-pending", "/dev/setup/line?pending=1"],
  ...["signup", "signin", "accept", "wrong_account", "expired"].map((k) => [`invite-${k}`, `/dev/invite?kind=${k}`] as const),
  ["team", "/dev/team"],
  ["team-full", "/dev/team?full=1"],
];

const routes = SET === "public" ? PUBLIC : FIXTURES;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

for (const [name, path] of routes) {
  test(`${name}`, async ({ page }, info) => {
    const res = await page.goto(path);
    await settle(page);
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    appendFileSync(
      join(OUT, "results.jsonl"),
      JSON.stringify({
        set: SET,
        project: info.project.name,
        name,
        path,
        status: res?.status(),
        overflowX: overflow,
        violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target })),
      }) + "\n"
    );
  });
}

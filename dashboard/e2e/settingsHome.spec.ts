import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.AUDIT_OUT || "/workspace/screens/settings-home";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("settings home: no auto-open, grouped list, deep links land", async ({ page }, info) => {
  const dir = join(OUT, info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.goto("/dev/settings-jobs", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  expect(new URL(page.url()).search).toBe("");
  const home = page.locator('[data-settings-menu="index"]');
  await expect(home).toBeVisible();
  for (const name of ["Hours", "Catalogue", "Policies", "FAQs", "Team"]) {
    await expect(home.getByRole("link", { name: new RegExp(`^${name}\\b`) })).toBeVisible();
  }
  await expect(home.getByText("When you are open, including holidays")).toBeVisible();
  await page.screenshot({ path: join(dir, "home.png"), fullPage: true });
  const v = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((x) => `${x.id}(${x.nodes.length})`);
  expect(v).toEqual([]);

  await home.getByRole("link", { name: /^Hours\b/ }).click();
  await expect(page).toHaveURL(/panel=hours/);
  await page.goto("/dev/settings-jobs?tab=train&panel=faqs", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/panel=faqs/);
  await expect(page.locator('[data-settings-menu="index"]')).toHaveCount(0);
  await page.screenshot({ path: join(dir, "deeplink-faqs.png") });
});

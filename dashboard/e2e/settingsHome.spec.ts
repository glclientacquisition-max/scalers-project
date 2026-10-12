import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.AUDIT_OUT || "/workspace/screens/settings-home-v2";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("settings home: no auto-open, grouped list, deep links land", async ({ page }, info) => {
  const dir = join(OUT, info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/dev/settings-jobs", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  expect(new URL(page.url()).search).toBe("");
  const home = page.locator('[data-settings-menu="index"]');
  await expect(home).toBeVisible();
  for (const name of ["Hours", "Catalogue", "Policies", "FAQs", "Team"]) {
    await expect(home.getByRole("link", { name: new RegExp(`^${name}\\b`) })).toBeVisible();
  }
  await expect(home.getByText("When you are open, including holidays")).toBeVisible();
  // Home: no rail on any width, and nothing moves after paint.
  await expect(page.locator('[data-settings-menu="rail"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.02);
  await page.screenshot({ path: join(dir, "home.png"), fullPage: true });
  const v = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((x) => `${x.id}(${x.nodes.length})`);
  expect(v).toEqual([]);

  await home.getByRole("link", { name: /^Hours\b/ }).click();
  await expect(page).toHaveURL(/panel=hours/);
  // Fixture rows point at the real /settings route; open the same section in the fixture.
  await page.goto("/dev/settings-jobs?tab=train&panel=hours", { waitUntil: "networkidle" });
  const wide = (page.viewportSize()?.width ?? 0) >= 768;
  const rail = page.locator('[data-settings-menu="rail"]');
  if (wide) {
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  } else {
    await expect(rail).toBeHidden();
  }
  const back = page.locator("[data-desk-back]").first();
  await expect(back).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, "section-hours.png"), fullPage: true });
  const v2 = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((x) => `${x.id}(${x.nodes.length})`);
  expect(v2).toEqual([]);
  await expect(back).toHaveAttribute("href", "/settings");
  await expect(back).toHaveAccessibleName("Settings");
  await page.goto("/dev/settings-jobs?tab=train&panel=faqs", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/panel=faqs/);
  await expect(page.locator('[data-settings-menu="index"]')).toHaveCount(0);
  await page.screenshot({ path: join(dir, "deeplink-faqs.png") });
});

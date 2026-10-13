import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Desk tabs (dev fixtures) still render and pass axe after the speed changes (dynamic panels, skeletons).
const TABS = ["/dev/home", "/dev/inbox", "/dev/contacts", "/dev/settings", "/dev/settings-jobs", "/dev/usage"];

for (const path of TABS) {
  test(`perf tabs: ${path} renders and passes axe`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    // scrollable-region-focusable (inbox) and nested-interactive (contacts) are on main today and fixed in
    // the ui-polish work (#660/#663); drop this once that lands.
    const res = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["scrollable-region-focusable", "nested-interactive"])
      .analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

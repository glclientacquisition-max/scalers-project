import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.AUDIT_OUT || "/workspace/screens/insights";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const axe = async (page: import("@playwright/test").Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${v.id}(${v.nodes.length})`);

for (const [slug, n] of [["thin", 2], ["some", 8], ["rich", 60]] as const) {
  test(`insights ${slug}`, async ({ page }, info) => {
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await page.goto(`/dev/insights?n=${n}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "What callers told us" })).toBeVisible();
    await page.screenshot({ path: join(dir, `${slug}.png`), fullPage: true });
    expect(await axe(page)).toEqual([]);
    if (slug === "thin") {
      await expect(page.getByText("Insights start after 5 reviewed calls")).toBeVisible();
      return;
    }
    await page.getByRole("button", { name: /Why sales were lost/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    if (slug === "rich") {
      await sheet.getByRole("button", { expanded: false }).first().click();
      await expect(sheet.getByRole("link").first()).toBeVisible();
    }
    await page.screenshot({ path: join(dir, `${slug}-sheet-lost.png`) });
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Busiest times/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, `${slug}-sheet-busiest.png`) });
    expect(await axe(page)).toEqual([]);
  });
}

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Capability gates (#657): Overview list, the Sheet bottom drawer, and the setup questions.
 * Fixtures need DASHBOARD_OPEN=true. Screenshots go to $AUDIT_OUT/<project>/gates-*.png.
 */
const OUT = process.env.AUDIT_OUT || "/workspace/screens/gates";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const vertical of ["retail", "home_services"] as const) {
  test(`overview gates ${vertical}`, async ({ page }, info) => {
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await page.goto(`/dev/home${vertical === "home_services" ? "?vertical=home_services" : ""}`);
    const list = page.getByRole("heading", { name: "What your Business Assistant can do" });
    await expect(list).toBeVisible();
    await expect(page.getByText("What your Business Assistant will say")).toBeVisible();
    await expect(page.getByText(/\bBA\b/)).toHaveCount(0);
    // Callbacks only: nothing promises a live transfer.
    await expect(page.getByRole("button", { name: /^Callbacks: / })).toBeVisible();
    await expect(page.getByText(/put you through|put callers through|transfer the call/i)).toHaveCount(0);
    await list.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(dir, `gates-${vertical}-list.png`), fullPage: true });
    const pageAxe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(pageAxe.violations.map((v) => v.id)).toEqual([]);

    const row = page.getByRole("button", { name: vertical === "retail" ? /^Holds: Needs setup/ : /^Bookings: Needs setup/ });
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Callers hear now")).toBeVisible();
    await page.waitForTimeout(500);
    // Bottom drawer: the panel touches the bottom edge at every width.
    const box = await dialog.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box).not.toBeNull();
    expect(Math.abs(box!.y + box!.height - vh)).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole("link", { name: /^Open Policies/ })).toBeVisible();
    await page.screenshot({ path: join(dir, `gates-${vertical}-sheet.png`) });
    const sheetAxe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(TAGS).analyze();
    expect(sheetAxe.violations.map((v) => v.id)).toEqual([]);
  });
}

for (const vertical of ["retail", "home_services"] as const) {
  test(`setup catalogue ${vertical}`, async ({ page }, info) => {
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await page.goto(`/dev/setup?step=catalogue${vertical === "home_services" ? "&vertical=home_services" : ""}`);
    if (vertical === "retail") {
      await expect(page.getByText("Do you hold items for customers?")).toBeVisible();
      await page.getByRole("radiogroup", { name: "Do you hold items for customers?" }).getByText("Yes").click();
      await expect(page.getByRole("switch", { name: /can be held/ })).toBeVisible();
    } else {
      await expect(page.getByRole("radiogroup", { name: "How bookings work" })).toBeVisible();
    }
    // The docked Continue bar sits over whatever scrolled under it; audit from the top like a fresh load.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(dir, `gates-setup-${vertical}.png`), fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(axe.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

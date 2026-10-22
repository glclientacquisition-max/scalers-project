import { expect, test, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/opt/cursor/artifacts/screenshots/admin-list-first-verify";

function tag(width: number, testInfo: TestInfo): string {
  const w = width >= 1200 ? "1280" : width >= 700 ? "768" : width >= 380 ? "390" : "360";
  const scheme = testInfo.project.use.colorScheme === "dark" ? "dark" : "light";
  return `${w}-${scheme}`;
}

test.describe("admin list-first verification", () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  });

  test("billing default shop list", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    await page.goto("/dev/admin-billing", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Plans" })).toBeVisible();
    await expect(page.getByLabel("Billing shops")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-billing-all.png`), fullPage: true });
  });

  test("billing waiting tab and chips", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    await page.goto("/dev/admin-billing", { waitUntil: "networkidle" });
    await page.getByLabel("Billing view").getByRole("button", { name: /^Waiting\b/i }).click();
    await expect(page.getByRole("button", { name: /No plan/i })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-billing-waiting.png`), fullPage: true });
  });

  test("billing reviews", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    await page.goto("/dev/admin-billing?view=attention", { waitUntil: "networkidle" });
    await page.getByLabel("Billing view").getByRole("button", { name: /^Reviews\b/i }).click();
    await expect(page.getByText("Collected amount has no receipt")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-billing-reviews.png`), fullPage: true });
  });

  test("today in admin shell", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    await page.goto("/dev/admin-shell", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByText("Volume today")).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-today-shell.png`), fullPage: true });
  });

  test("plans versions list", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    await page.goto("/dev/admin-plans", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
    await expect(page.getByText("Catalogue")).toHaveCount(0);
    await expect(page.getByLabel("Plans").getByRole("button", { name: /^Versions\b/i })).toBeVisible();
    await expect(page.getByLabel("Plan versions").getByRole("button", { name: /^Live\b/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "New draft" })).toBeVisible();
    await expect(page.getByText("Starter")).toBeVisible();
    await expect(page.getByText(/Version 1 · KSh 5,000/)).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-plans-versions-live.png`), fullPage: true });
    await page.getByLabel("Plan versions").getByRole("button", { name: /^Draft\b/i }).click();
    await expect(page.getByRole("button", { name: /Version 2 · KSh 6,000/ })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-plans-versions-draft.png`), fullPage: true });
  });

  test("plans businesses tab", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    await page.goto("/dev/admin-plans", { waitUntil: "networkidle" });
    await page.getByLabel("Plans").getByRole("button", { name: /^Businesses\b/i }).click();
    await expect(page.getByText("Kileleshwa Dental")).toBeVisible();
    await expect(page.getByText("No plan")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag(width, testInfo)}-plans-businesses.png`), fullPage: true });
  });
});

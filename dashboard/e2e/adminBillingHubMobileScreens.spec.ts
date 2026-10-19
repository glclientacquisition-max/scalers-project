import { expect, test, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/opt/cursor/artifacts/screenshots/billing-hub-mobile";

function widthTag(width: number): string {
  if (width >= 380) return "390";
  return "360";
}

function schemeName(testInfo: TestInfo): string {
  return testInfo.project.use.colorScheme === "dark" ? "dark" : "light";
}

const FIXTURE_INVOICES = {
  ok: true,
  missing: false,
  invoices: [
    {
      id: "inv-fix-1",
      number: "SCL-2026-000042",
      statusLabel: "Overdue",
      totalLabel: "KSh 20,000",
      balanceLabel: "KSh 20,000",
      dueAt: "2026-10-10T00:00:00.000Z",
      pdfPath: "/api/admin/billing/invoices/inv-fix-1/pdf",
      htmlPath: "/api/admin/billing/invoices/inv-fix-1?format=html",
      canMintPayLink: true,
    },
    {
      id: "inv-fix-2",
      number: "SCL-2026-000043",
      statusLabel: "Open",
      totalLabel: "KSh 7,000",
      balanceLabel: "KSh 7,000",
      dueAt: "2026-11-01T00:00:00.000Z",
      pdfPath: "/api/admin/billing/invoices/inv-fix-2/pdf",
      htmlPath: "/api/admin/billing/invoices/inv-fix-2?format=html",
      canMintPayLink: true,
    },
  ],
};

test.describe("admin billing hub mobile previews", () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.route("**/api/admin/billing?history_for=*", async (route) => {
      await route.fulfill({ json: { ok: true, history: [] } });
    });
    await page.route("**/api/admin/billing?invoices_for=*", async (route) => {
      await route.fulfill({ json: FIXTURE_INVOICES });
    });
  });

  test("billing needs you cards", async ({ page }, testInfo) => {
    const tag = widthTag(page.viewportSize()?.width ?? 390);
    const scheme = schemeName(testInfo);
    await page.goto("/dev/admin-billing", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `${tag}-${scheme}-billing-needs-cards.png`), fullPage: true });
  });

  test("billing low minutes queue", async ({ page }, testInfo) => {
    const tag = widthTag(page.viewportSize()?.width ?? 390);
    const scheme = schemeName(testInfo);
    await page.goto("/dev/admin-billing", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Low minutes/i }).click();
    await expect(page.getByPlaceholder("Business, number, or package")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag}-${scheme}-billing-low-queue.png`), fullPage: true });
  });

  test("billing all directory", async ({ page }, testInfo) => {
    const tag = widthTag(page.viewportSize()?.width ?? 390);
    const scheme = schemeName(testInfo);
    await page.goto("/dev/admin-billing", { waitUntil: "networkidle" });
    await page.getByLabel("Billing view").getByRole("button", { name: /^All\b/i }).click();
    await expect(page.getByLabel("Platform billing snapshot")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${tag}-${scheme}-billing-all-directory.png`), fullPage: true });
  });

  test("shop money invoices", async ({ page }, testInfo) => {
    const tag = widthTag(page.viewportSize()?.width ?? 390);
    const scheme = schemeName(testInfo);
    await page.goto("/dev/admin-shop", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Sample Shop" })).toBeVisible();
    const money = page.locator("#shop-money");
    await money.scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: "Invoices" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${tag}-${scheme}-shop-money-invoices.png`), fullPage: true });
    testInfo.annotations.push({ type: "screenshots", description: OUT });
  });
});

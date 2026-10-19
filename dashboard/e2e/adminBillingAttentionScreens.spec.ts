import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/opt/cursor/artifacts/screenshots/billing-attention";

function widthTag(width: number): string {
  if (width >= 1200) return "1280";
  if (width >= 700) return "768";
  if (width >= 380) return "390";
  return "360";
}

test.describe("admin billing attention fixtures", () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test("needs attention, invoices, and Bachs status", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    const tag = widthTag(width);

    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

    await page.goto("/dev/admin-billing?view=attention", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Collected amount has no receipt")).toBeVisible();
    await page.screenshot({ path: join(OUT, `${tag}-needs-attention.png`), fullPage: true });

    await page.goto("/dev/admin-invoices", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByText("SCL-2026-000006")).toBeVisible();
    await page.screenshot({ path: join(OUT, `${tag}-invoices.png`), fullPage: true });

    await page.goto("/dev/admin-invoice", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: "SCL-2026-000006" })).toBeVisible();
    await expect(page.getByText("Growth, October")).toBeVisible();
    await page.screenshot({ path: join(OUT, `${tag}-invoice.png`), fullPage: true });

    await page.goto("/dev/admin-payments", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(page.getByText("Changed in hosting settings")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Package editor" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Plan changes" })).toBeDisabled();
    await page.screenshot({ path: join(OUT, `${tag}-payments.png`), fullPage: true });

    await page.goto("/dev/admin-shop", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: "Sample Shop" })).toBeVisible();
    const money = page.locator("#shop-money");
    await money.scrollIntoViewIfNeeded();
    await expect(money.getByText("Collected amount has no receipt")).toBeVisible();
    await expect(money.getByText("Live payments stay off while this business is on beta.")).toBeVisible();
    await expect(money.getByRole("switch", { name: "Live payments" })).toBeDisabled();
    await page.screenshot({ path: join(OUT, `${tag}-shop-money.png`), fullPage: true });

    await money.getByRole("switch", { name: "Charging" }).click();
    await expect(page.getByText("Start charging?")).toBeVisible();
    await expect(page.locator(".desk-drawer").getByLabel("Reason")).toBeVisible();
    await page.screenshot({ path: join(OUT, `${tag}-confirm.png`) });

    testInfo.annotations.push({ type: "screenshots", description: OUT });
  });
});

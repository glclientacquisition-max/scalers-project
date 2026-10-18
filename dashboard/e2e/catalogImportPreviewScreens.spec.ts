import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/opt/cursor/artifacts/catalog-import-preview";
const CATALOG = "/dev/settings-jobs?tab=catalog";

function widthTag(width: number): string | null {
  if (width >= 1200) return "1280";
  if (width >= 380 && width < 700) return "390";
  return null;
}

const SERVICE_PASTE = [
  "Carpet wash - KSh 60 per sq ft",
  "Rooms - from KSh 1,500",
  "Hourly cleaning - 500-800 per hour",
  "Consult - Ask",
].join("\n");

const PRODUCT_PASTE = "Notebook - KSh 2,000\nPen - Ask";

test.describe("catalogue import preview type labels", () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test("paste services and products previews", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    const tag = widthTag(width);
    test.skip(tag === null, "Only 390 and 1280 viewports");

    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.goto(CATALOG, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const pasteServices = page.getByRole("button", { name: "Paste list" }).first();
    await pasteServices.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Paste services")).toBeVisible();
    await sheet.locator("textarea").fill(SERVICE_PASTE);
    await page.waitForTimeout(300);
    await expect(sheet.getByText("Fixed", { exact: true })).toBeVisible();
    await expect(sheet.getByText("· KSh 60 per sq ft")).toBeVisible();
    await page.screenshot({
      path: join(OUT, `${tag}-paste-services-preview.png`),
      fullPage: false,
    });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    const pasteProducts = page.getByRole("button", { name: "Paste list" }).nth(1);
    await pasteProducts.click();
    const productSheet = page.getByRole("dialog");
    await expect(productSheet.getByText("Paste products")).toBeVisible();
    await productSheet.locator("textarea").fill(PRODUCT_PASTE);
    await page.waitForTimeout(300);
    await expect(productSheet.getByText("Quote")).toBeVisible();
    await page.screenshot({
      path: join(OUT, `${tag}-paste-products-preview.png`),
      fullPage: false,
    });

    testInfo.annotations.push({ type: "screenshots", description: OUT });
  });
});

import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/opt/cursor/artifacts/catalogue-prices";
const CATALOG = "/dev/settings-jobs?tab=train&panel=catalog";

function widthTag(width: number): string | null {
  if (width >= 1200) return "1280";
  if (width >= 700 && width < 1200) return "768";
  if (width >= 380 && width < 700) return "390";
  return null;
}

test.describe("catalogue price form screenshots", () => {
  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test("capture price types and validation", async ({ page }, testInfo) => {
    const width = page.viewportSize()?.width ?? 390;
    const tag = widthTag(width);
    test.skip(tag === null, "Only 390, 768, and 1280 viewports");

    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.goto(CATALOG, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const priceGroup = page.getByRole("radiogroup", { name: "Price type" }).first();
    await priceGroup.scrollIntoViewIfNeeded();
    await expect(priceGroup).toBeVisible();

    const shot = async (name: string) => {
      await page.screenshot({
        path: join(OUT, `${tag}-${name}.png`),
        fullPage: false,
      });
    };

    await shot("catalogue-overview");

    const pickKind = async (label: RegExp) => {
      await page.getByRole("radio", { name: label }).first().click();
      await page.waitForTimeout(200);
    };

    await pickKind(/^Fixed$/);
    await shot("price-fixed");
    await pickKind(/^From$/);
    await shot("price-from");
    await pickKind(/^Range$/);
    await shot("price-range");
    await pickKind(/^Quote$/);
    await shot("price-quote");

    await pickKind(/^Fixed$/);
    const min = page.locator('input[id$="-min"]:visible').first();
    await min.fill("0");
    await min.blur();
    await expect(page.locator('[id$="-min-err"]:visible')).toContainText(/amount above 0/i);
    await shot("price-validation-error");

    testInfo.annotations.push({ type: "screenshots", description: OUT });
  });
});

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = "/opt/cursor/artifacts/desk-assistant-say";

async function expectNoDevOverlay(page: import("@playwright/test").Page) {
  await expect(page.getByText(/\d+\s+Issue/)).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`overview payments sheet 360px ${scheme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/dev/home-assistant?checks=1", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Check how customers pay" }).click();
    await expect(page.getByRole("heading", { name: "Check how customers pay" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Looks right, save" })).toBeVisible();
    await expectNoDevOverlay(page);
    await mkdir(OUT, { recursive: true });
    const file = join(OUT, `overview-payments-sheet-360-${scheme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await testInfo.attach(`overview-payments-sheet-360-${scheme}`, { path: file, contentType: "image/png" });
  });
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = "/opt/cursor/artifacts/desk-assistant-say";

async function expectNoDevOverlay(page: import("@playwright/test").Page) {
  await expect(page.getByText(/\d+\s+Issue/)).toHaveCount(0);
}

const PHONE_WIDTHS = [360, 390] as const;
const SCHEMES = ["light", "dark"] as const;

for (const width of PHONE_WIDTHS) {
  for (const scheme of SCHEMES) {
    test(`assistant say settings ${width}px ${scheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dev/settings-jobs?tab=assistant-say", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "What your Business Assistant will say" })).toBeVisible();
      const hoursRow = page.locator("main li").filter({ hasText: "Opening hours" });
      await expect(hoursRow.getByText("Will say", { exact: true })).toBeVisible();
      await expect(page.getByText("Using team default")).toBeVisible();
      await expectNoDevOverlay(page);
      await mkdir(OUT, { recursive: true });
      const file = join(OUT, `assistant-say-${width}-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`assistant-say-${width}-${scheme}`, { path: file, contentType: "image/png" });
    });

    test(`overview get ready ${width}px ${scheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/dev/home-assistant?checks=1", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Get ready for calls" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Is this right?" })).toBeVisible();
      await expectNoDevOverlay(page);
      await mkdir(OUT, { recursive: true });
      const file = join(OUT, `overview-ready-${width}-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`overview-ready-${width}-${scheme}`, { path: file, contentType: "image/png" });
    });
  }
}

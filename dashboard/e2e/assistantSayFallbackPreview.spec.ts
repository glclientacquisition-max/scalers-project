import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = "/opt/cursor/artifacts/desk-assistant-say";

for (const scheme of ["light", "dark"] as const) {
  test(`when unsure editor and preview ${scheme} 360px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/dev/settings-jobs?tab=assistant-say", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "When unsure" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Test what it says" })).toBeVisible();
    await page.getByRole("button", { name: "Show answer" }).click();
    await expect(page.locator("[data-lookup-preview]")).toBeVisible();
    await mkdir(OUT, { recursive: true });
    const file = join(OUT, `assistant-say-fallback-preview-360-${scheme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await testInfo.attach(`fallback-preview-360-${scheme}`, { path: file, contentType: "image/png" });
  });
}

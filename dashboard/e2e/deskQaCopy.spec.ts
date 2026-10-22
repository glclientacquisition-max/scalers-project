import { mkdir } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "/opt/cursor/artifacts/desk-qa";

const SCHEMES = ["light", "dark"] as const;

async function noSideScroll(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

async function axeSerious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => v.id)).toEqual([]);
}

for (const scheme of SCHEMES) {
  test(`sign in renders in ${scheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await noSideScroll(page);
    await axeSerious(page);
    await mkdir(SHOTS, { recursive: true });
    const file = `${SHOTS}/${testInfo.project.name}-login-${scheme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    await testInfo.attach(`login-${scheme}`, { path: file, contentType: "image/png" });
  });

  test(`inbox tabs stay on screen in ${scheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/dev/inbox");
    await expect(page.getByRole("navigation", { name: "Filter by purpose" })).toBeVisible();
    await noSideScroll(page);
    await mkdir(SHOTS, { recursive: true });
    const file = `${SHOTS}/${testInfo.project.name}-inbox-${scheme}.png`;
    await page.screenshot({ path: file });
    await testInfo.attach(`inbox-${scheme}`, { path: file, contentType: "image/png" });
  });

  test(`call transcript opens on the first line in ${scheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/dev/ticket");
    const stream = page.locator("[data-transcript-stream]");
    await expect(stream).toBeVisible();
    await expect(stream.locator("[role=group]").first()).toContainText("Can you confirm the visit tomorrow morning?");
    const aside = page.locator("[data-ticket-summary]");
    const overflow = await aside.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflow === "clip" || overflow === "hidden").toBeTruthy();
    await noSideScroll(page);
    await mkdir(SHOTS, { recursive: true });
    const file = `${SHOTS}/${testInfo.project.name}-ticket-${scheme}.png`;
    await page.screenshot({ path: file });
    await testInfo.attach(`ticket-${scheme}`, { path: file, contentType: "image/png" });
  });
}

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Password reset screens: render at every width, no sideways scroll, no serious axe findings. */

async function noSidewaysScroll(page: import("@playwright/test").Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

async function axeClean(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => v.id)).toEqual([]);
}

test("sign in links to forgot password", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("forgot password form", async ({ page }) => {
  await page.goto("/forgot-password?email=owner%40example.com");
  await expect(page.getByLabel("Email")).toHaveValue("owner@example.com");
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  await noSidewaysScroll(page);
  await axeClean(page);
});

test("reset page without a recovery session offers a new link", async ({ page }) => {
  for (const [q, heading] of [
    ["", "This link has expired"],
    ["?link=expired", "This link has expired"],
    ["?link=invalid", "This link doesn't work"],
  ] as const) {
    await page.goto(`/reset-password${q}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/forgot-password");
  }
  await noSidewaysScroll(page);
  await axeClean(page);
});

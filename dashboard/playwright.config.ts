import { defineConfig, devices } from "@playwright/test";

/**
 * Structural gate for the desk (docs/frontend/FRONTEND_2_0_CHARTER.md §8).
 * Runs against the /dev/* fixtures with DASHBOARD_OPEN=true. No pixel diffs; screenshots are artifacts.
 *
 *   npm run test:e2e            starts `next dev` on 3077 and runs every project
 *   E2E_BASE_URL=http://localhost:3020 npm run test:e2e   reuse a running server
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3077";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "off",
    channel: "chrome",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev --turbopack -p 3077",
        url: `${baseURL}/dev/kit`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { ...process.env, DASHBOARD_OPEN: "true" },
      },
  projects: [
    { name: "phone-360-light", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: "light" } },
    { name: "phone-390-dark", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" } },
    { name: "tablet-768-light", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, colorScheme: "light" } },
    { name: "desk-1280-dark", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
  ],
});

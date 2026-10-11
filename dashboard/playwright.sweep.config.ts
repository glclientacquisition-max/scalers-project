import { defineConfig, devices } from "@playwright/test";

/** Design sweep: 4 widths x light and dark. E2E_BASE_URL=... AUDIT_OUT=... npx playwright test -c playwright.sweep.config.ts polishSweep */
const widths: Array<[string, number, number, boolean]> = [
  ["phone-360", 360, 740, true],
  ["phone-390", 390, 844, true],
  ["tablet-768", 768, 1024, false],
  ["desk-1280", 1280, 800, false],
];
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3077", channel: "chrome" },
  projects: widths.flatMap(([name, width, height, mobile]) =>
    (["light", "dark"] as const).map((colorScheme) => ({
      name: `${name}-${colorScheme}`,
      use: { ...devices["Desktop Chrome"], viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme },
    }))
  ),
});

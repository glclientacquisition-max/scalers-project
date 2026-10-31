import { expect, test } from "@playwright/test";

const STATES = [
  ["idle", "Talk to the assistant"],
  ["consent", "Before you start"],
  ["mic_denied", "The microphone is blocked"],
  ["connecting", "Connecting"],
  ["live", "3:00"],
  ["ended", "Thanks. The demo has ended."],
  ["disabled", "Demo paused."],
  ["busy", "All demo lines are busy, try again in a minute."],
  ["limit", "You've used today's demos."],
  ["error", "The demo did not start. Try again."],
  ["unsupported", "Your browser can't run the live demo."],
] as const;

test("each voice demo state renders its line", async ({ page }) => {
  for (const [state, line] of STATES) {
    await page.goto(`/dev/voice-demo?state=${state}`);
    await expect(page.locator("[data-demo-state]")).toHaveAttribute("data-demo-state", state);
    await expect(page.getByText(line, { exact: false }).first()).toBeVisible();
  }
});

test("Kiswahili busy and paused lines render", async ({ page }) => {
  await page.goto("/dev/voice-demo?state=busy&lang=sw");
  await expect(page.getByText("Mistari yote ya onyesho inatumika, jaribu tena baada ya dakika moja.")).toBeVisible();
  await page.goto("/dev/voice-demo?state=disabled&lang=sw");
  await expect(page.getByText("Onyesho limesimamishwa.")).toBeVisible();
});

test("consent controls meet the 44px hit floor", async ({ page }) => {
  await page.goto("/dev/voice-demo?state=consent");
  const start = page.getByRole("button", { name: "Start demo" });
  await expect(start).toBeVisible();
  const box = await start.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  const back = page.getByRole("button", { name: "Back" });
  const backBox = await back.boundingBox();
  expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

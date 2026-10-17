import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Payments and Policies in Settings, at 360/390/768/1280 x light/dark (playwright.sweep.config.ts).
 * BEFORE=1 against the base build only takes screenshots.
 */
const OUT = process.env.AUDIT_OUT || "/workspace/screens/payments-policies";
const BEFORE = process.env.BEFORE === "1";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const POLICIES = "/dev/settings-jobs?tab=train&panel=policies";

async function axe(page: Page, label: string) {
  const v = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((x) => `${x.id}(${x.nodes.length}) ${x.nodes.map((n) => n.target.join(" ") + " " + (n.failureSummary || "").slice(0, 160)).join(" | ")}`);
  expect(v, label).toEqual([]);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // The Next dev badge is not product UI.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(500);
}

test("payments and policies", async ({ page }, info) => {
  const dir = join(OUT, BEFORE ? "before" : "after", info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.goto(POLICIES, { waitUntil: "networkidle" });
  await settle(page);
  await page.screenshot({ path: join(dir, "policies.png"), fullPage: true });
  if (BEFORE) {
    await page.goto("/dev/structured", { waitUntil: "networkidle" });
    await settle(page);
    await page.screenshot({ path: join(dir, "payments-fixture.png"), fullPage: true });
    return;
  }
  await axe(page, "policies page");

  // Old text was read into fields: Is this right?
  await expect(page.getByText("Is this right?")).toBeVisible();
  await expect(page.locator("#pay-row-mpesa_till")).toContainText("123456");

  // Add Pochi la Biashara through the picker drawer; bad number is caught in the drawer.
  await page.getByRole("button", { name: "Add a way to pay" }).click();
  const pick = page.getByRole("dialog", { name: "Add a way to pay" });
  await expect(pick).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, "sheet-add-method.png") });
  await axe(page, "add method sheet");
  await pick.getByRole("button", { name: /Pochi la Biashara/ }).click();
  const pochi = page.getByRole("dialog", { name: "Pochi la Biashara" });
  await expect(pochi).toBeVisible();
  await pochi.getByLabel("Pochi la Biashara number").fill("0712 34");
  await pochi.getByRole("button", { name: "Done" }).click();
  await expect(pochi.getByRole("alert")).toContainText("Kenyan mobile");
  await pochi.getByLabel("Pochi la Biashara number").fill("0712 345 678");
  await expect(pochi.getByText(/Pochi la Biashara on 0712 345 678/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, "sheet-pochi.png") });
  await axe(page, "pochi sheet");
  await pochi.getByRole("button", { name: "Done" }).click();
  await expect(pochi).toBeHidden();
  await expect(page.locator("#pay-row-pochi")).toContainText("0712 345 678");

  // Paybill: business number plus "customer's name" as the account.
  await page.getByRole("button", { name: "Add a way to pay" }).click();
  await page.getByRole("dialog", { name: "Add a way to pay" }).getByRole("button", { name: /M-Pesa Paybill/ }).click();
  const pb = page.getByRole("dialog", { name: "M-Pesa Paybill" });
  await pb.getByLabel("Business number").fill("247247");
  await pb.getByRole("radio", { name: /Customer's name/ }).click();
  await expect(pb.getByLabel("Account number", { exact: true })).toHaveCount(0);
  await pb.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#pay-row-mpesa_paybill")).toContainText("247247");

  // Several timings at once.
  await page.locator("#pay-row-timing").click();
  const when = page.getByRole("dialog", { name: "When customers pay" });
  await when.getByRole("checkbox", { name: "Before delivery" }).click();
  await when.getByRole("checkbox", { name: "On delivery" }).click(); // already on from the old text: toggles off
  await when.getByRole("checkbox", { name: "On delivery" }).click(); // back on
  await expect(when.getByRole("checkbox", { name: "Before delivery" })).toHaveAttribute("aria-checked", "true");
  await expect(when.getByRole("checkbox", { name: "On delivery" })).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, "sheet-timing.png") });
  await when.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#pay-row-timing")).toContainText("Before delivery, On delivery");

  await page.getByLabel("Payment note (optional)").fill("Send the M-Pesa message on WhatsApp");
  const hear = page.locator("[data-payments-editor]").getByText(/^You can pay by/);
  await expect(hear).toContainText("Pochi la Biashara on 0712 345 678");
  await expect(hear).toContainText("Paybill 247247, with your name as the account");
  await expect(hear).toContainText("Customers pay before delivery or on delivery.");
  await expect(hear).toContainText("Send the M-Pesa message on WhatsApp.");

  // Rules: old Returns text shows and opens pre-filled; add Delivery with a fee.
  await expect(page.locator("#rule-row-returns")).toContainText("Old text");
  await page.getByRole("button", { name: "Add a rule" }).click();
  await page.getByRole("dialog", { name: "Add a rule" }).getByRole("button", { name: /^Delivery/ }).click();
  const del = page.getByRole("dialog", { name: "Delivery" });
  await del.getByRole("radio", { name: "One fee" }).click();
  await del.getByRole("button", { name: "Done" }).click();
  await expect(del.getByRole("alert")).toContainText("delivery fee");
  await del.getByLabel("Fee (KSh)").fill("200");
  await del.getByLabel("Where you deliver (optional)").fill("Nairobi CBD");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, "sheet-delivery.png") });
  await axe(page, "delivery sheet");
  await del.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#rule-row-delivery")).toContainText("We deliver to Nairobi CBD the same day. Delivery costs KSh 200.");

  // STATE: nothing above is saved yet. Opening and closing drawers keeps every edit.
  await page.locator("#pay-row-pochi").click();
  await page.getByRole("dialog", { name: "Pochi la Biashara" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#pay-row-pochi")).toContainText("0712 345 678");
  await expect(page.locator("#rule-row-delivery")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(dir, "policies-edited.png"), fullPage: true });

  // Leaving with unsaved edits asks first, and Keep editing keeps them all.
  const wide = (page.viewportSize()?.width ?? 0) >= 768;
  const leave = wide
    ? page.locator('[data-settings-menu="rail"]').getByRole("link", { name: /^Hours/ })
    : page.locator("[data-desk-back]").first();
  await leave.click();
  const discard = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(discard).toBeHidden();
  await expect(page).toHaveURL(/panel=policies/);
  await expect(page.locator("#pay-row-pochi")).toContainText("0712 345 678");
  await expect(page.locator("#rule-row-delivery")).toContainText("KSh 200");
  await expect(page.getByLabel("Payment note (optional)")).toHaveValue("Send the M-Pesa message on WhatsApp");
  await axe(page, "policies after edits");
});

test("home services: booking rules", async ({ page }, info) => {
  test.skip(BEFORE, "after only");
  const dir = join(OUT, "after", info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.goto(`${POLICIES}&vertical=home_services`, { waitUntil: "networkidle" });
  await settle(page);
  await expect(page.locator("#pay-row-mpesa_paybill")).toContainText("542542, customer's name");
  await expect(page.locator("#pay-row-timing")).toContainText("50% deposit, then balance");
  await page.getByRole("button", { name: "Add a rule" }).click();
  const pick = page.getByRole("dialog", { name: "Add a rule" });
  const first = pick.getByRole("button").filter({ hasText: /Cancellation|Booking changes|Late or no-show/ }).first();
  await expect(first).toContainText("Cancellation");
  await pick.getByRole("button", { name: /Late or no-show/ }).click();
  const ns = page.getByRole("dialog", { name: "Late or no-show" });
  await ns.getByRole("radio", { name: "Call-out fee" }).click();
  await ns.getByLabel("Call-out fee (KSh)").fill("500");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, "home-sheet-no-show.png") });
  await axe(page, "no-show sheet");
  await ns.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#rule-row-no_show")).toContainText("KSh 500 call-out fee");
  await page.screenshot({ path: join(dir, "home-policies.png"), fullPage: true });
  await axe(page, "home policies");
});

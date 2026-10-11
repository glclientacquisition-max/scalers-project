import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Mobile + design sweep over the /dev fixtures. Records horizontal overflow, small tap targets and axe.
 * Screens: $AUDIT_OUT/<project>/<slug>.png. Findings: $AUDIT_OUT/results.jsonl.
 */
const OUT = process.env.AUDIT_OUT || "/workspace/screens/polish/after";
const STRICT = process.env.SWEEP_STRICT !== "0";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const ROUTES: Array<[string, string]> = [
  ["home", "/dev/home"],
  ["desk-shell", "/dev/desk-shell"],
  ["settings-bare", "/dev/settings-jobs"],
  ["settings-hours", "/dev/settings-jobs?tab=train&panel=hours"],
  ["settings-faqs", "/dev/settings-jobs?tab=train&panel=faqs"],
  ["settings-policies", "/dev/settings-jobs?tab=train&panel=policies"],
  ["setup-catalogue", "/dev/setup?step=catalogue"],
  ["setup-faqs", "/dev/setup?step=faqs"],
  ["setup-business", "/dev/setup?step=business"],
  ["inbox", "/dev/inbox"],
  ["contacts", "/dev/contacts"],
  ["team", "/dev/team"],
  ["usage", "/dev/usage"],
  ["invite", "/dev/invite"],
  ["ticket", "/dev/ticket"],
  ["kit", "/dev/kit"],
];

for (const [slug, url] of ROUTES) {
  test(`sweep ${slug}`, async ({ page }, info) => {
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    const res = await page.goto(url);
    if (!res || res.status() >= 400) test.skip(true, `no fixture ${url}`);
    await page.waitForTimeout(600);
    const facts = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const overflowX = document.documentElement.scrollWidth > vw + 1;
      const offenders: string[] = [];
      const small: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.position === "fixed") continue;
        if (r.right > vw + 1 && offenders.length < 6 && !el.closest("[data-scroll-x],.overflow-x-auto")) {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
        }
        if (el.matches("button,a[href],[role=button],input:not([type=hidden]),select,[role=switch],[role=radio]") && !el.closest("p,li>p")) {
          if ((r.height < 24 || r.width < 24) && small.length < 8) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return { overflowX, offenders, small };
    });
    await page.screenshot({ path: join(dir, `${slug}.png`), fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const violations = axe.violations.map((v) => `${v.id}(${v.nodes.length})`);
    appendFileSync(join(OUT, "results.jsonl"), JSON.stringify({ project: info.project.name, slug, ...facts, violations }) + "\n");
    if (STRICT) {
      expect(facts.overflowX, facts.offenders.join(", ")).toBe(false);
      expect(violations).toEqual([]);
    }
  });
}

test("account menu", async ({ page }, info) => {
  const dir = join(OUT, info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.goto("/dev/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const trigger = page.locator("[data-account-bar] button").last();
  if (!(await trigger.count())) test.skip(true, "no account bar in fixture");
  await trigger.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, "account-menu.png") });
  const phone = page.viewportSize()!.width < 768;
  const panel = phone ? page.getByRole("dialog") : page.locator("[data-account-menu]");
  await expect(panel).toBeVisible();
  if (phone) {
    // Bottom Sheet: touches the bottom edge, full width, theme picker inline.
    const b = (await panel.boundingBox())!;
    expect(Math.abs(b.y + b.height - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
    await expect(panel.getByText("Appearance")).toBeVisible();
  }
  const box = (await panel.boundingBox())!;
  const vp = page.viewportSize()!;
  appendFileSync(join(OUT, "results.jsonl"), JSON.stringify({ project: info.project.name, slug: "account-menu", box, vp }) + "\n");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  const appearance = page.getByRole("menuitem", { name: "Appearance" }).or(page.getByRole("button", { name: "Appearance" }));
  if (!phone && (await appearance.count())) {
    await appearance.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, "account-menu-appearance.png") });
  }
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

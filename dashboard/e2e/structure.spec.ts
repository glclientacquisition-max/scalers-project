import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * One composition at every width (charter §5). Each fixture must:
 *   1. never scroll sideways
 *   2. keep every interactive control at or above the hard floor (24px), and warn under 44px
 *   3. pass axe with zero serious or critical violations
 * A full-page screenshot per route and project is attached as an artifact for eyes, not for diffing.
 *
 * `strict` routes fail the run. The rest are legacy screens: findings are attached as artifacts
 * and annotated as debt until the charter phase that rebuilds them lands, then they move to `strict`.
 */
const routes: Array<{ path: string; strict: boolean }> = [
  { path: "/dev/kit", strict: true },
  { path: "/dev/admin-overview", strict: true },
  { path: "/dev/admin-voices", strict: true },
  { path: "/dev/quality", strict: true },
  { path: "/dev/quality/biz-dusted", strict: true },
  { path: "/dev/quality/call/HD_dev_low", strict: true },
  { path: "/dev/quality/empty", strict: true },
  { path: "/dev/desk-shell", strict: false },
  { path: "/dev/home", strict: false },
  { path: "/dev/inbox", strict: false },
  { path: "/dev/contacts", strict: false },
  { path: "/dev/pronunciation", strict: false },
];

const HARD_FLOOR = 24;
const TARGET = 44;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

async function overflowX(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, client: doc.clientWidth };
  });
}

async function smallHits(page: Page, floor: number) {
  return page.evaluate((floor) => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, [role="button"], input, select, textarea, [role="tab"], [role="radio"], [role="menuitem"]',
      ),
    );
    const out: Array<{ label: string; w: number; h: number }> = [];
    for (const el of controls) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden") continue;
      if (Math.min(rect.width, rect.height) >= floor) continue;
      out.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
    return out;
  }, floor);
}

/** Fails strict routes; records debt for the rest. */
async function gate(testInfo: TestInfo, strict: boolean, name: string, findings: unknown[]) {
  if (findings.length === 0) return;
  await testInfo.attach(name, { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  if (strict) {
    expect(findings, name).toEqual([]);
  } else {
    testInfo.annotations.push({ type: "debt", description: `${name}: ${findings.length}` });
  }
}

for (const { path, strict } of routes) {
  test.describe(path, () => {
    test("no horizontal overflow", async ({ page }, testInfo) => {
      await page.goto(path);
      await settle(page);
      const { scroll, client } = await overflowX(page);
      await gate(testInfo, strict, "horizontal-overflow", scroll > client ? [{ scroll, client }] : []);
    });

    test("hit sizes", async ({ page }, testInfo) => {
      await page.goto(path);
      await settle(page);
      const under44 = await smallHits(page, TARGET);
      const warn = under44.filter((hit) => Math.min(hit.w, hit.h) >= HARD_FLOOR);
      const fail = under44.filter((hit) => Math.min(hit.w, hit.h) < HARD_FLOOR);
      if (warn.length) {
        await testInfo.attach("under-44px", { body: JSON.stringify(warn, null, 2), contentType: "application/json" });
      }
      await gate(testInfo, strict, "under-24px", fail);
    });

    test("axe serious and critical", async ({ page }, testInfo) => {
      await page.goto(path);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const blocking = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) }));
      await gate(testInfo, strict, "axe", blocking);
    });

    test("screenshot", async ({ page }, testInfo) => {
      await page.goto(path);
      await settle(page);
      const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
      await testInfo.attach(`${path.replace(/\//g, "_")}.png`, { body: shot, contentType: "image/png" });
    });
  });
}

test.describe("/dev/kit interactions", () => {
  test("sheet stays inside the viewport, traps focus, closes on Escape", async ({ page }) => {
    await page.goto("/dev/kit");
    await settle(page);
    await page.getByRole("button", { name: "Open sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Archive this call?" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)))
      .toBe(true);
    const viewport = page.viewportSize()!;
    // Poll past the 240ms enter transition (translate-y-4 while data-starting-style is set).
    const edges = async () => {
      const box = (await dialog.boundingBox())!;
      return { left: box.x, right: box.x + box.width, bottom: box.y + box.height };
    };
    await expect.poll(async () => (await edges()).bottom).toBeLessThanOrEqual(viewport.height + 1);
    const { left, right } = await edges();
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("drawer follows a downward drag past halfway and closes", async ({ page }) => {
    await page.goto("/dev/kit");
    await settle(page);
    await page.getByRole("button", { name: "Open sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Archive this call?" });
    await expect(dialog).toBeVisible();
    const viewport = page.viewportSize()!;
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      if (!box) return false;
      return box.y + box.height <= viewport.height + 2 && box.y < viewport.height * 0.85;
    }).toBe(true);
    const box = (await dialog.boundingBox())!;
    const x = box.x + box.width / 2;
    const startY = box.y + 16;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY + box.height * 0.7, { steps: 12 });
    await page.mouse.up();
    await expect(dialog).toBeHidden();
  });

  test("menu opens on click and moves with arrow keys", async ({ page }) => {
    await page.goto("/dev/kit");
    await settle(page);
    await page.getByRole("button", { name: "More" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: /Archive/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("dark theme flips the canvas", async ({ page }) => {
    await page.goto("/dev/kit");
    await settle(page);
    // Computed colours come back as `color(srgb r g b)` for color-mix tokens; compare luminance.
    const luminance = () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".desk-theme > div")!;
        const probe = document.createElement("canvas").getContext("2d")!;
        probe.fillStyle = getComputedStyle(el).backgroundColor;
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      });
    await page.getByRole("radio", { name: "Dark" }).click();
    const dark = await luminance();
    await page.getByRole("radio", { name: "Light" }).click();
    const light = await luminance();
    expect(light).toBeGreaterThan(0.9);
    expect(dark).toBeLessThan(0.1);
  });

  test("dark sheet is opaque surface, dimmed by --scrim, theme-color follows canvas", async ({ page }) => {
    await page.goto("/dev/kit");
    await settle(page);
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Open sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Archive this call?" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => page.locator(".desk-drawer-backdrop").evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.3);
    const measured = await dialog.evaluate((el) => {
      const probe = document.createElement("canvas").getContext("2d")!;
      const fill = (cssColor: string) => {
        probe.fillStyle = cssColor;
        probe.fillRect(0, 0, 1, 1);
        return [...probe.getImageData(0, 0, 1, 1).data];
      };
      const root = getComputedStyle(document.documentElement);
      const sheet = getComputedStyle(el);
      const backdrop = document.querySelector(".desk-drawer-backdrop");
      const viewport = document.querySelector(".desk-drawer-viewport");
      const scrim = backdrop ? getComputedStyle(backdrop).backgroundColor : "";
      const frame = viewport ? getComputedStyle(viewport).backgroundColor : "";
      return {
        sheet: fill(sheet.backgroundColor),
        surface: fill(root.getPropertyValue("--surface").trim()),
        scrim: fill(scrim),
        scrimToken: fill(root.getPropertyValue("--scrim").trim()),
        frameAlpha: Number((frame.match(/[\d.]+/g) || [])[3] ?? (frame === "transparent" ? 0 : 1)),
        backdropOpacity: backdrop ? Number(getComputedStyle(backdrop).opacity) : -1,
        backdropFilter: sheet.backdropFilter,
        themeColor: document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content")?.replace(/\s/g, "").toLowerCase(),
        canvas: root.getPropertyValue("--canvas").trim().replace(/\s/g, "").toLowerCase(),
      };
    });
    expect(measured.sheet.slice(0, 3)).toEqual(measured.surface.slice(0, 3));
    expect(measured.scrim.slice(0, 3)).toEqual(measured.scrimToken.slice(0, 3));
    expect(measured.frameAlpha).toBe(0);
    expect(measured.backdropOpacity).toBeGreaterThan(0.3);
    expect(measured.backdropOpacity).toBeLessThan(0.5);
    expect(measured.backdropFilter === "none" || measured.backdropFilter === "").toBeTruthy();
    expect(measured.themeColor).toBe(measured.canvas);
  });

  test("keeps This device pick after reload and on login", async ({ page, context }) => {
    await page.goto("/dev/kit");
    await settle(page);
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("scalers-desk-theme"))).toBe("dark");
    expect((await context.cookies()).find((cookie) => cookie.name === "scalers-desk-theme")?.value).toBe("dark");
    await page.reload();
    await settle(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await page.goto("/login");
    await settle(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });
});

test("More opens from the keyboard and Escape returns focus", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width >= 768, "phone tab bar only");
  await page.goto("/dev/quality");
  await settle(page);
  const more = page.getByRole("button", { name: "More" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(more).toBeFocused();
});

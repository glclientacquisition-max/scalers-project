import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Phone pull and fit for the owner desk fixtures.
 * Real /home, /calls, /contacts, /wallet, /settings, and /admin need a session.
 * These routes are the local stand-in (DASHBOARD_OPEN).
 */
const FIT = [
  "/dev/home",
  "/dev/inbox",
  "/dev/ticket",
  "/dev/contacts",
  "/dev/contacts/file",
  "/dev/usage",
  "/dev/settings",
];

function phone(testInfo: TestInfo): boolean {
  return (testInfo.project.use.viewport?.width ?? 1280) < 768;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const nodes: HTMLElement[] = [document.documentElement];
    const main = document.querySelector("[data-desk-main], [data-admin-main], main");
    if (main instanceof HTMLElement) nodes.push(main);
    return nodes
      .map((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      .filter((row) => row.scroll > row.client + 1);
  });
}

async function fieldSizes(page: Page) {
  return page.evaluate(() => {
    const skip = new Set(["hidden", "checkbox", "radio", "file", "button", "submit", "range", "color", "image"]);
    const bad: Array<{ label: string; size: number }> = [];
    for (const el of document.querySelectorAll<HTMLElement>("input, textarea, select")) {
      const type = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
      if (skip.has(type)) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden" || style.display === "none") continue;
      const size = Number.parseFloat(style.fontSize);
      if (size < 16) {
        bad.push({
          label: (el.getAttribute("aria-label") || el.id || el.tagName).slice(0, 40),
          size,
        });
      }
    }
    return bad;
  });
}

async function smallActions(page: Page) {
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll<HTMLElement>("button, [data-desk-tabbar] a, [data-desk-rail] a"),
    ];
    const bad: Array<{ label: string; w: number; h: number }> = [];
    for (const el of nodes) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden" || style.display === "none") continue;
      if (Math.min(rect.width, rect.height) >= 44) continue;
      bad.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
    return bad;
  });
}

async function swipeDown(page: Page) {
  return page.evaluate(async () => {
    const main = document.querySelector("[data-desk-main], [data-admin-main]");
    if (!(main instanceof HTMLElement)) return { commits: null, mark: null, tabTop: null, height: 0, width: 0 };
    const box = main.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 12, Math.max(12, box.left + 28));
    const y = Math.min(window.innerHeight - 96, Math.max(12, box.top + 36));
    const target = main;
    const touch = (clientY: number) =>
      new Touch({
        identifier: 1,
        target,
        clientX: x,
        clientY,
        pageX: x,
        pageY: clientY,
        screenX: x,
        screenY: clientY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
      });
    const fire = (type: string, clientY: number, live: Touch[]) => {
      target.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: live,
          targetTouches: live,
          changedTouches: [touch(clientY)],
        })
      );
    };
    fire("touchstart", y, [touch(y)]);
    fire("touchmove", y + 96, [touch(y + 96)]);
    let markEl: Element | null = null;
    for (let frame = 0; frame < 8; frame += 1) {
      markEl = document.querySelector("[data-pull-refresh]");
      if (markEl) break;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const markBox = markEl?.getBoundingClientRect() ?? null;
    const tab = document.querySelector("[data-desk-tabbar]");
    const tabShown =
      tab instanceof HTMLElement && getComputedStyle(tab).display !== "none" && tab.getClientRects().length > 0;
    const tabTop = tabShown ? tab.getBoundingClientRect().top : null;
    fire("touchend", y + 96, []);
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const host = document.querySelector("[data-pull-host]");
    return {
      commits: host?.getAttribute("data-pull-commits") ?? null,
      mark: markBox
        ? {
            top: markBox.top,
            bottom: markBox.bottom,
            left: markBox.left,
            right: markBox.right,
            height: markBox.height,
          }
        : null,
      tabTop,
      height: window.innerHeight,
      width: window.innerWidth,
    };
  });
}

test.describe("desk pull and fit", () => {
  for (const path of FIT) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      expect(await overflow(page)).toEqual([]);
    });

    test(`${path} keeps phone fields at 16px and actions at 44px`, async ({ page }, testInfo) => {
      await page.goto(path);
      await settle(page);
      if (phone(testInfo) || (testInfo.project.use.viewport?.width ?? 0) <= 768) {
        expect(await fieldSizes(page)).toEqual([]);
      }
      expect(await smallActions(page)).toEqual([]);
    });
  }

  test("phone lists show tabs, a ticket hides them, back brings them back", async ({ page }, testInfo) => {
    test.skip(!phone(testInfo), "Bottom tabs are the phone nav");
    await page.goto("/dev/home");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(1);
    await page.goto("/dev/contacts");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(1);
    await page.goto("/dev/usage");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(1);
    await page.goto("/dev/settings");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(1);
    await page.goto("/dev/ticket");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(0);
    await page.getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL(/\/dev\/home/);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(1);
    await page.goto("/dev/contacts/file");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(0);
    await page.getByRole("link", { name: "Contacts" }).click();
    await expect(page).toHaveURL(/\/dev\/contacts$/);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(1);
  });

  test("wide layouts keep the rail and hide bottom tabs", async ({ page }, testInfo) => {
    test.skip(phone(testInfo), "Rail is the md+ nav");
    await page.goto("/dev/home");
    await settle(page);
    await expect(page.locator("[data-desk-rail]")).toBeVisible();
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(0);
    await page.goto("/dev/ticket");
    await settle(page);
    await expect(page.locator("[data-desk-tabbar]:visible")).toHaveCount(0);
  });

  test("phone pull refreshes Home and Usage at the top only", async ({ page }, testInfo) => {
    test.skip(!phone(testInfo), "Pull is phone width only");
    for (const path of ["/dev/home", "/dev/usage"]) {
      await page.goto(path);
      await settle(page);
      const pulled = await swipeDown(page);
      expect(pulled.commits).toBe("1");
      expect(pulled.mark).not.toBeNull();
      expect(pulled.mark!.top).toBeGreaterThanOrEqual(0);
      expect(pulled.mark!.left).toBeGreaterThanOrEqual(-1);
      expect(pulled.mark!.right).toBeLessThanOrEqual(pulled.width + 1);
      expect(pulled.mark!.bottom).toBeLessThanOrEqual(pulled.height + 1);
      expect(pulled.mark!.height).toBeGreaterThanOrEqual(44);
      if (pulled.tabTop != null) {
        expect(pulled.mark!.bottom).toBeLessThanOrEqual(pulled.tabTop + 1);
      }
      await page.evaluate(() => {
        const main = document.querySelector("[data-desk-main]");
        if (!(main instanceof HTMLElement)) return;
        const spacer = document.createElement("div");
        spacer.style.height = "1600px";
        main.appendChild(spacer);
        main.scrollTop = 280;
      });
      const held = await swipeDown(page);
      expect(held.commits).toBe("1");
    }
  });

  test("phone pull skips a dirty Profile field and refreshes a clean one", async ({ page }, testInfo) => {
    test.skip(!phone(testInfo), "Pull is phone width only");
    await page.goto("/dev/settings");
    await settle(page);
    const clean = await swipeDown(page);
    expect(clean.commits).toBe("1");
    await page.getByLabel("Business name").fill("Edited Dental");
    const dirty = await swipeDown(page);
    expect(dirty.commits).toBe("1");
  });

  test("wide pointer drag does not refresh", async ({ page }, testInfo) => {
    test.skip(phone(testInfo), "Desktop drag is out of scope");
    await page.goto("/dev/home");
    await settle(page);
    const pulled = await swipeDown(page);
    expect(pulled.commits ?? "0").toBe("0");
  });

  test("phone admin list pull refreshes at the top only", async ({ page }, testInfo) => {
    test.skip(!phone(testInfo), "Pull is phone width only");
    await page.goto("/dev/packages");
    await settle(page);
    const pulled = await swipeDown(page);
    expect(pulled.commits).toBe("1");
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "1600px";
      document.body.appendChild(spacer);
      const scrolling = document.scrollingElement;
      if (scrolling instanceof HTMLElement) scrolling.scrollTop = 240;
    });
    const held = await swipeDown(page);
    expect(held.commits).toBe("1");
  });
});

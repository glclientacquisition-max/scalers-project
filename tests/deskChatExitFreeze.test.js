const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function markHiddenSource() {
  const helperPath = path.join(__dirname, "../dashboard/src/lib/deskTicketChat.ts");
  const script = `
    import { markHiddenDeskTickets } from ${JSON.stringify(helperPath)};
    process.stdout.write(markHiddenDeskTickets.toString());
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return ran.stdout.trim();
}

function deskCss() {
  return read("dashboard/src/app/globals.css").replace(/@tailwind[^;]+;/g, "");
}

describe("desk chat exit freeze", () => {
  it("does not lock the list well from a hidden ticket", () => {
    const nav = read("dashboard/src/components/DeskNav.tsx");
    const css = read("dashboard/src/app/globals.css");
    const chrome = read("dashboard/src/components/DeskRouteChrome.tsx");
    const pull = read("dashboard/src/components/PhonePullRefresh.tsx");
    assert.doesNotMatch(nav, /has-\[\[data-desk-bleed\]\]/);
    assert.match(css, /data-desk-ticket-chat\] \[data-desk-main\]/);
    assert.match(css, /:not\(\[data-desk-route-ready\]\):has\(\[data-desk-bleed\]\)/);
    assert.match(
      css,
      /\[data-desk-route-ready\]:not\(\[data-desk-ticket-chat\]\) \[data-ticket-chat\]/
    );
    assert.match(css, /pointer-events:\s*none !important/);
    assert.match(chrome, /markHiddenDeskTickets/);
    assert.match(pull, /closest\("\[inert\]"\)/);
    assert.equal(
      fs.existsSync(path.join(__dirname, "..", "dashboard/src/app/(desk)/loading.tsx")),
      false
    );
  });

  it("lets the list scroll and take taps after the path is /calls", async () => {
    const { chromium } = require("../dashboard/node_modules/playwright");
    const mark = markHiddenSource();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.setContent(`<!doctype html>
        <html>
          <head>
            <style>
              ${deskCss()}
              [data-desk-main] { height: 480px; overflow-y: auto; min-height: 0; }
              #spacer { height: 1600px; }
            </style>
          </head>
          <body>
            <div class="desk-theme" data-desk-route-ready>
              <main data-desk-main id="main">
                <button id="list-hit" type="button">Amina</button>
                <div id="spacer"></div>
                <div id="ticket" data-ticket-chat data-desk-bleed data-pull-host>
                  <button id="ticket-hit" type="button">Chat</button>
                  <div id="pane" data-pull-scroll></div>
                </div>
              </main>
              <nav data-desk-tabbar id="tabs">Inbox</nav>
            </div>
          </body>
        </html>`);

      const list = await page.evaluate(() => {
        const main = document.getElementById("main");
        const ticket = document.getElementById("ticket");
        const tabs = document.getElementById("tabs");
        const mainStyle = getComputedStyle(main);
        const ticketStyle = getComputedStyle(ticket);
        return {
          overflowY: mainStyle.overflowY,
          ticketDisplay: ticketStyle.display,
          ticketPointer: ticketStyle.pointerEvents,
          tabsDisplay: getComputedStyle(tabs).display,
        };
      });
      assert.equal(list.overflowY, "auto");
      assert.equal(list.ticketDisplay, "none");
      assert.equal(list.ticketPointer, "none");
      assert.notEqual(list.tabsDisplay, "none");

      const before = await page.evaluate(() => document.getElementById("main").scrollTop);
      const link = page.locator("#list-hit");
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 8, box.y + 80);
      await page.mouse.wheel(0, 400);
      await page.mouse.wheel(0, 400);
      const after = await page.evaluate(() => document.getElementById("main").scrollTop);
      assert.ok(after > before, `list scrollTop stayed ${after}`);
      await page.evaluate(() => {
        document.getElementById("main").scrollTop = 0;
      });
      await link.click({ timeout: 3000 });

      await page.evaluate(() => {
        const ticket = document.getElementById("ticket");
        ticket.style.setProperty("display", "flex", "important");
        ticket.style.setProperty("pointer-events", "auto", "important");
        ticket.style.setProperty("position", "absolute");
        ticket.style.setProperty("inset", "0");
        ticket.style.setProperty("z-index", "20");
      });
      const covered = await page.evaluate(() => {
        const hit = document.getElementById("list-hit");
        const rect = hit.getBoundingClientRect();
        const node = document.elementFromPoint(rect.left + 4, rect.top + 4);
        return node && node.id;
      });
      assert.equal(covered, "ticket-hit");

      await page.evaluate((src) => {
        const fn = (0, eval)(`(${src})`);
        fn(document.querySelector(".desk-theme"));
      }, mark);

      const released = await page.evaluate(() => {
        const ticket = document.getElementById("ticket");
        const hit = document.getElementById("list-hit");
        const rect = hit.getBoundingClientRect();
        const node = document.elementFromPoint(rect.left + 4, rect.top + 4);
        const pane = document.getElementById("pane");
        return {
          hit: node && node.id,
          inert: ticket.hasAttribute("inert"),
          hidden: ticket.getAttribute("aria-hidden"),
          pullHost: ticket.hasAttribute("data-pull-host"),
          paneInert: Boolean(pane.closest("[inert]")),
        };
      });
      assert.equal(released.hit, "list-hit");
      assert.equal(released.inert, true);
      assert.equal(released.hidden, "true");
      assert.equal(released.pullHost, false);
      assert.equal(released.paneInert, true);
      await link.click({ timeout: 3000 });

      const live = await page.evaluate((src) => {
        const shell = document.querySelector(".desk-theme");
        shell.setAttribute("data-desk-ticket-chat", "");
        const ticket = document.getElementById("ticket");
        ticket.removeAttribute("style");
        const fn = (0, eval)(`(${src})`);
        fn(shell);
        const main = document.getElementById("main");
        return {
          overflowY: getComputedStyle(main).overflowY,
          display: getComputedStyle(ticket).display,
          inert: ticket.hasAttribute("inert"),
        };
      }, mark);
      assert.equal(live.overflowY, "hidden");
      assert.notEqual(live.display, "none");
      assert.equal(live.inert, false);
    } finally {
      await browser.close();
    }
  });
});

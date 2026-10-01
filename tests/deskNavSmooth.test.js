const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const memoryPath = path.join(__dirname, "../dashboard/src/lib/deskScrollMemory.ts");
const nestedPath = path.join(__dirname, "../dashboard/src/lib/deskTicketChat.ts");

function loadMemory() {
  const source = fs
    .readFileSync(memoryPath, "utf8")
    .replace('from "./deskTicketChat"', `from ${JSON.stringify(nestedPath)}`);
  const tempPath = path.join(os.tmpdir(), "desk-scroll-memory-load.ts");
  fs.writeFileSync(tempPath, source);
  const script = `
    import {
      applyDeskScroll,
      deskListScrollKey,
      holdDeskScrollSaves,
      snapshotDeskScroll,
      writeDeskScroll,
    } from ${JSON.stringify(tempPath)};

    const cases = {
      home: deskListScrollKey("/home"),
      homeSlash: deskListScrollKey("/home/"),
      inbox: deskListScrollKey("/calls", ""),
      inboxFilter: deskListScrollKey("/calls", "purpose=needs"),
      inboxFilterQuery: deskListScrollKey("/calls", "?purpose=archived"),
      ticket: deskListScrollKey("/calls/abc-123"),
      contacts: deskListScrollKey("/contacts"),
      contactFile: deskListScrollKey("/contacts/abc-123"),
      contactImport: deskListScrollKey("/contacts/import"),
      wallet: deskListScrollKey("/wallet"),
      settings: deskListScrollKey("/settings"),
      settingsHours: deskListScrollKey("/settings", "tab=hours"),
      settingsAppearance: deskListScrollKey("/settings", "tab=appearance"),
      requests: deskListScrollKey("/requests", "status=open"),
      appointments: deskListScrollKey("/appointments"),
      unknown: deskListScrollKey("/login"),
      empty: deskListScrollKey(""),
      nil: deskListScrollKey(null),
    };

    const main = { scrollTop: 240 };
    const key = cases.inboxFilter;
    snapshotDeskScroll(main, key);
    holdDeskScrollSaves(true);
    main.scrollTop = 0;
    writeDeskScroll(key, 0);
    const box = {
      _top: 12,
      get scrollTop() { return this._top; },
      set scrollTop(value) {
        this._top = value;
        writeDeskScroll(key, value);
      },
    };
    applyDeskScroll(box, key);
    const restored = box.scrollTop;
    applyDeskScroll(box, null);
    const nestedTop = box.scrollTop;
    applyDeskScroll(box, key);
    const back = box.scrollTop;
    holdDeskScrollSaves(false);
    box.scrollTop = 80;
    writeDeskScroll(key, 80);
    applyDeskScroll(box, cases.home);
    const homeTop = box.scrollTop;
    applyDeskScroll(box, key);
    const remembered = box.scrollTop;

    console.log(JSON.stringify({ cases, restored, nestedTop, back, homeTop, remembered }));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("desk navigation smoothness", () => {
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const layout = read("dashboard/src/app/(desk)/layout.tsx");
  const admin = read("dashboard/src/components/AdminNav.tsx");
  const state = read("dashboard/src/components/DeskNavState.tsx");
  const memory = read("dashboard/src/lib/deskScrollMemory.ts");
  const master = read("docs/frontend/design-system/MASTER.md");

  it("remembers list scroll and zeros nested records without dropping the list", () => {
    const got = loadMemory();
    assert.equal(got.cases.home, "/home");
    assert.equal(got.cases.homeSlash, "/home");
    assert.equal(got.cases.inbox, "/calls");
    assert.equal(got.cases.inboxFilter, "/calls?purpose=needs");
    assert.equal(got.cases.inboxFilterQuery, "/calls?purpose=archived");
    assert.equal(got.cases.ticket, null);
    assert.equal(got.cases.contacts, "/contacts");
    assert.equal(got.cases.contactFile, null);
    assert.equal(got.cases.contactImport, null);
    assert.equal(got.cases.wallet, "/wallet");
    assert.equal(got.cases.settings, "/settings");
    assert.equal(got.cases.settingsHours, "/settings?tab=hours");
    assert.equal(got.cases.settingsAppearance, "/settings?tab=appearance");
    assert.equal(got.cases.requests, "/requests?status=open");
    assert.equal(got.cases.appointments, "/appointments");
    assert.equal(got.cases.unknown, null);
    assert.equal(got.cases.empty, null);
    assert.equal(got.cases.nil, null);
    assert.equal(got.restored, 240);
    assert.equal(got.nestedTop, 0);
    assert.equal(got.back, 240);
    assert.equal(got.homeTop, 0);
    assert.equal(got.remembered, 80);
    assert.match(memory, /export function deskListScrollKey/);
    assert.match(memory, /isDeskNestedPath/);
  });

  it("keeps one mounted desk shell and optimistic DESK_LINKS", () => {
    assert.match(nav, /export const DESK_LINKS/);
    assert.match(nav, /scroll=\{false\}/);
    assert.match(nav, /useLinkStatus/);
    assert.match(nav, /useDeskPendingHref/);
    assert.match(nav, /needsCount = 0/);
    assert.match(nav, /needsCount \|\| fromShell/);
    assert.match(layout, /DeskNavHost/);
    assert.match(layout, /data-desk-main/);
    assert.match(layout, /DeskScrollRestore/);
    assert.match(layout, /<DeskRail \/>/);
    assert.match(layout, /<DeskTabBar \/>/);
    assert.doesNotMatch(layout, /fallback=\{<DeskRail/);
    assert.doesNotMatch(layout, /fallback=\{<DeskTabBar/);
    assert.equal(
      fs.existsSync(path.join(__dirname, "..", "dashboard/src/app/(desk)/loading.tsx")),
      false
    );
    assert.match(state, /useSearchParams/);
    assert.match(layout, /<Suspense fallback=\{null\}>\s*<DeskScrollRestore/);
    assert.doesNotMatch(nav, /Menu/);
    assert.match(master, /No \`\(desk\)\/loading\.tsx\`/);
    assert.match(master, /scroll=\{false\}/);
  });

  it("keeps Super Admin nav separate, 44px, and highlighted before commit", () => {
    const links = read("dashboard/src/lib/adminLinks.ts");
    assert.match(admin, /min-h-11/);
    assert.match(admin, /useLinkStatus/);
    assert.match(admin, /aria-label="Super Admin"/);
    assert.doesNotMatch(admin, /DESK_LINKS/);
    assert.doesNotMatch(links, /DESK_LINKS/);
    assert.doesNotMatch(admin, /DeskNavHost/);
    assert.match(admin, /scroll=\{false\}/);
    assert.match(links, /href: "\/admin\/packages", label: "Packages"/);
    assert.match(admin, /deskShiftClass/);
    assert.match(admin, /focusRingVisible/);
  });
});

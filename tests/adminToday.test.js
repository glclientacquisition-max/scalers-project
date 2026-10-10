"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const model = require("../dashboard/src/lib/adminTodayModel.ts");
const links = require("../dashboard/src/lib/adminLinks.ts");

/** Body of one top-level function, from its declaration to the next top-level declaration. */
function fnBody(src, name) {
  const start = src.search(new RegExp(`(?:export )?async function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export |async function |function |type |const )/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

const WRITES = /\.(insert|update|upsert|delete)\(|\.rpc\(|sendOpsMail|mailKinds|persistOpen|persistNotify|persistResolve|ackOpsNotice|recordAdminAction/;

describe("Super Admin Today: reads only", () => {
  const page = read("dashboard/src/app/admin/(console)/page.tsx");
  const today = read("dashboard/src/lib/adminToday.ts");
  const ops = read("dashboard/src/lib/platformOps.ts");
  const admin = read("dashboard/src/lib/admin.ts");

  it("loads through read-only helpers, never the notice check", () => {
    assert.match(page, /readPlatformOps\(\)/);
    assert.doesNotMatch(page, /evaluatePlatformOps/);
    assert.doesNotMatch(page, WRITES);
    assert.doesNotMatch(page, /"use client"/);
  });

  it("does no insert, update, rpc, or mail on page load", () => {
    assert.doesNotMatch(today, WRITES);
    assert.doesNotMatch(fnBody(ops, "readPlatformOps"), WRITES);
    assert.doesNotMatch(fnBody(ops, "gatherPlatformSignals"), WRITES);
    assert.doesNotMatch(fnBody(ops, "loadOpsSettings"), WRITES);
    assert.doesNotMatch(fnBody(admin, "getAdminOverview"), WRITES);
    assert.doesNotMatch(fnBody(admin, "listBusinesses"), WRITES);
    // Platform still runs the check, so alerts keep firing from there.
    assert.match(fnBody(ops, "evaluatePlatformOps"), /persistOpen/);
    assert.match(fnBody(ops, "evaluatePlatformOps"), /mailKinds/);
    assert.match(read("dashboard/src/app/admin/(console)/platform/page.tsx"), /evaluatePlatformOps/);
  });
});

describe("Super Admin Today: numbers from calls only", () => {
  it("counts from EAT midnight and compares with the same stretch last week", () => {
    const now = new Date("2026-10-09T10:30:00.000Z"); // 13:30 EAT
    assert.equal(model.eatDayStart(now).toISOString(), "2026-10-08T21:00:00.000Z");
    const late = new Date("2026-10-09T22:30:00.000Z"); // 01:30 EAT on the 10th
    assert.equal(model.eatDayStart(late).toISOString(), "2026-10-09T21:00:00.000Z");
    const w = model.todayWindows(now);
    assert.deepEqual(w.today, { start: "2026-10-08T21:00:00.000Z", end: "2026-10-09T10:30:00.000Z" });
    assert.deepEqual(w.lastWeek, { start: "2026-10-01T21:00:00.000Z", end: "2026-10-02T10:30:00.000Z" });
    assert.equal(model.eatDayLabel(now), "Friday 9 Oct");
  });

  it("shows counts with last week, and gaps as gaps instead of zero", () => {
    const now = new Date("2026-10-09T10:30:00.000Z");
    const rows = model.todayNumberRows(
      { total: { today: 14, lastWeek: 11 }, needsHuman: null, abandoned: { today: 2, lastWeek: 0 } },
      now,
    );
    assert.deepEqual(rows.map((r) => r.title), ["Calls today", "Needed a person", "Caller hung up early", "Couldn't answer"]);
    assert.equal(rows[0].value, "14");
    assert.equal(rows[0].detail, "Last Friday by now: 11");
    assert.equal(rows[1].available, false);
    assert.equal(rows[1].value, "");
    assert.equal(rows[2].value, "2");
    assert.equal(rows[3].available, false);
    assert.equal(rows[3].detail, "Per business on Calls. Traced calls only.");
    assert.equal(rows[3].href, "/admin/quality");
  });

  it("reads resolution counts from calls and treats a missing column as a gap", () => {
    const src = read("dashboard/src/lib/adminToday.ts");
    assert.match(src, /from\("calls"\)/);
    assert.match(src, /pair\("needs_human"\)/);
    assert.match(src, /pair\("abandoned"\)/);
    assert.match(src, /isMissingColumn\(err\)\) return null/);
    assert.doesNotMatch(src, /voice_turn_traces/);
  });
});

describe("Super Admin Today: status line and Needs you", () => {
  it("names what is down, or says all is normal", () => {
    assert.deepEqual(model.statusSentence([]), { tone: "ok", text: "All systems normal" });
    assert.deepEqual(
      model.statusSentence([
        { active: true, critical: true, title: "Speech" },
        { active: true, critical: false, title: "Money" },
      ]),
      { tone: "down", text: "Speech is down" },
    );
    assert.deepEqual(model.statusSentence([{ active: true, critical: false, title: "Numbers" }]), {
      tone: "attention",
      text: "Numbers needs a look",
    });
  });

  const now = new Date("2026-10-09T10:30:00.000Z");
  const businesses = [
    { id: "new", name: "Fresh", status: "waiting", createdAt: "2026-10-08T08:00:00.000Z", packageName: null },
    { id: "stuck", name: "Stuck Co", status: "waiting", createdAt: "2026-10-02T08:00:00.000Z", packageName: null },
    { id: "nopack", name: "No Pack", status: "active", createdAt: "2026-09-01T08:00:00.000Z", packageName: null },
    { id: "quiet", name: "Quiet", status: "active", createdAt: "2026-08-01T08:00:00.000Z", packageName: "Starter" },
    { id: "busy", name: "Busy", status: "active", createdAt: "2026-08-01T08:00:00.000Z", packageName: "Growth" },
    { id: "young", name: "Young", status: "active", createdAt: "2026-10-07T08:00:00.000Z", packageName: "Starter" },
    { id: "gone", name: "Gone", status: "archived", createdAt: "2026-07-01T08:00:00.000Z", packageName: null },
  ];
  const notice = { key: "ops-speech", title: "Speech", detail: "", href: "/admin/platform#escalate", stamp: "Open" };

  it("orders notices, waiting (oldest first, stuck after 3 days), no package, then quiet", () => {
    const rows = model.todayQueue({ noticeRows: [notice], businesses, callingBusinessIds: new Set(["busy"]), now });
    assert.deepEqual(
      rows.map((r) => [r.key, r.stamp]),
      [
        ["ops-speech", "Open"],
        ["biz-stuck", "Stuck"],
        ["biz-new", "Waiting"],
        ["biz-nopack", "Package"],
        ["quiet-quiet", "Quiet"],
      ],
    );
    assert.equal(rows[1].detail, "Waiting for a number for 7 days");
    for (const row of rows) assert.ok(row.href.startsWith("/admin/"), row.key);
  });

  it("flags nobody as quiet when the call read failed", () => {
    const rows = model.todayQueue({ noticeRows: [], businesses, callingBusinessIds: null, now });
    assert.ok(!rows.some((r) => r.stamp === "Quiet"));
    assert.deepEqual(model.quietCandidates(businesses, now), ["quiet", "busy"]);
  });
});

describe("Super Admin nav: eight destinations, phone 4 + More", () => {
  const nav = read("dashboard/src/components/AdminNav.tsx");

  it("lists the eight in order and puts four on the phone bar", () => {
    assert.deepEqual(
      links.ADMIN_LINKS.map((l) => l.label),
      ["Today", "Businesses", "Calls", "Billing", "Numbers", "Platform", "Activity", "Settings"],
    );
    assert.deepEqual(links.ADMIN_PHONE_TABS.map((l) => l.label), ["Today", "Businesses", "Calls", "Billing"]);
    assert.deepEqual(links.ADMIN_MORE_LINKS.map((l) => l.label), ["Numbers", "Platform", "Activity", "Settings"]);
  });

  it("links only to screens that exist; nothing is pending now Activity ships", () => {
    const consoleDir = path.join(ROOT, "dashboard/src/app/admin/(console)");
    for (const item of links.ADMIN_LINKS) {
      if (item.pending) {
        assert.equal(fs.existsSync(path.join(consoleDir, item.href.replace("/admin/", ""), "page.tsx")), false, item.label);
        continue;
      }
      // Calls → /admin/quality ships in #603; this branch carries it (merge #603 first).
      const [route, hash] = item.href.split("#");
      const rel = route === "/admin" ? "page.tsx" : path.join(route.replace("/admin/", ""), "page.tsx");
      assert.ok(fs.existsSync(path.join(consoleDir, rel)), `${item.label} → ${item.href}`);
      if (hash) assert.match(read("dashboard/src/components/AdminTodayPanel.tsx"), new RegExp(`id="${hash}"`));
    }
    assert.equal(links.ADMIN_LINKS.filter((l) => l.pending).length, 0);
  });

  it("opens More as a bottom Sheet, not a centred dialog", () => {
    assert.match(nav, /<Sheet open=\{open\} onOpenChange=\{setOpen\} title="More"/);
    assert.match(nav, /title="More"/);
    assert.match(nav, /theme="admin"/);
    assert.match(nav, /aria-haspopup="dialog"/);
    assert.doesNotMatch(nav, /DeskDialog|window\.confirm|role="dialog"/);
    assert.doesNotMatch(nav, /framer-motion|motion\/react/);
  });

  it("lights Billing on Packages and More on its rows", () => {
    assert.equal(links.adminRouteActive("/admin/packages", "/admin/billing", false), true);
    assert.equal(links.adminRouteActive("/admin", "/admin#calls", true), false);
    assert.equal(links.adminMoreActive("/admin/platform"), true);
    assert.equal(links.adminMoreActive("/admin/voices"), true);
    assert.equal(links.adminMoreActive("/admin/billing"), false);
  });
});

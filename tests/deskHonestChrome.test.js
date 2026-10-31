const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function loadHelpers() {
  const nav = path.join(__dirname, "../dashboard/src/lib/businessSettingsNav.ts");
  const chat = path.join(__dirname, "../dashboard/src/lib/deskTicketChat.ts");
  const script = `
    import { parseBusinessSettingsTab, settingsNavItems } from ${JSON.stringify(nav)};
    import { ownerAssistLabel, ownerDeskLine } from ${JSON.stringify(chat)};
    const out = {
      updatesTab: parseBusinessSettingsTab("updates"),
      todayTab: parseBusinessSettingsTab("today"),
      importTab: parseBusinessSettingsTab("import"),
      navLabels: settingsNavItems().map((row) => row.label),
      unknown: ownerAssistLabel("Unknown"),
      needsHuman: ownerAssistLabel("Needs human"),
      resolved: ownerAssistLabel("Resolved"),
      failed: ownerDeskLine("Needs human. Notify failed."),
      caller: ownerDeskLine("Caller needed a human"),
      kept: ownerDeskLine("Escalated to Amina"),
    };
    console.log(JSON.stringify(out));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("honest chrome P0", () => {
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const board = read("dashboard/src/components/InboxPileBoard.tsx");
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const addMany = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  const form = read("dashboard/src/components/TenantForm.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");

  it("drops the search All button and keeps the table select-all", () => {
    assert.doesNotMatch(toolbar, /InboxSelectAll|Select all|>All</);
    assert.match(board, /aria-label=\{allOn \? "Clear" : "Select all"\}/);
    assert.match(read("dashboard/src/lib/inboxNiche.ts"), /label: "All"/);
  });

  it("keeps Updates on Home and off the settings rail", () => {
    const got = loadHelpers();
    assert.equal(got.updatesTab, "menu");
    assert.equal(got.todayTab, "menu");
    assert.equal(got.importTab, "import");
    assert.equal(got.navLabels.includes("Updates"), false);
    assert.match(home, /<UpdateStatus tenant=\{tenant\} \/>/);
    assert.match(read("dashboard/src/components/home/UpdateStatus.tsx"), /DailyBulletinPanel/);
    assert.doesNotMatch(shell, /DailyBulletinPanel/);
    assert.doesNotMatch(shell, /tab === "updates"/);
  });

  it("hides Visits on Shop and Holds on home services", () => {
    const niche = read("dashboard/src/lib/inboxNiche.ts");
    assert.match(niche, /resolvedType\(input\) !== "retail"/);
    assert.match(niche, /resolvedType\(input\) !== "home_services"/);
    assert.match(niche, /if \(showsVisitQueue\(vertical\)\)/);
    assert.match(niche, /if \(showsHoldQueue\(vertical\)\)/);
    assert.match(niche, /export function purposeForPack/);
    assert.match(home, /showsVisitQueue/);
    assert.match(home, /showsHoldQueue/);
    assert.match(home, /visitQueue \? work\.requested : 0/);
    assert.match(home, /holdQueue \? work\.toFulfill : 0/);
    assert.match(calls, /purposeForPack\(resolvedFilter, vertical, counts\.needs\)/);
    assert.match(calls, /purposeFilters\(vertical\)/);
  });

  it("uses one bulk add (Add many: Paste, File) and no separate Import panels", () => {
    assert.match(addMany, /\{ value: "paste", label: "Paste" \}/);
    assert.match(addMany, /\{ value: "file", label: "File" \}/);
    assert.doesNotMatch(addMany, /Atomic Habits/);
    assert.doesNotMatch(shell, /KnowledgeIngestPanel|CatalogImportPanel/);
  });

  it("labels the three notify toggles Urgent, Follow-up, and Ops", () => {
    assert.match(form, /key: "receives_escalation", label: "Urgent"/);
    assert.match(form, /key: "receives_inbox", label: "Follow-up"/);
    assert.match(form, /key: "receives_ops", label: "Ops"/);
    assert.match(form, /Channels follow How we notify\./);
    assert.match(form, /note=\{TEAM_NOTIFY_CHANNEL_NOTE\}/);
    assert.match(require("node:fs").readFileSync(require("path").join(__dirname, "..", "dashboard/src/components/AlertContactsList.tsx"), "utf8"), /aria-describedby="team-notify-channels"/);
    assert.doesNotMatch(form, /label: "SMS"/);
    assert.doesNotMatch(form, /label: "WhatsApp"/);
    assert.doesNotMatch(form, /label: "Email"/);
    assert.doesNotMatch(form, /<span>SMS<\/span>/);
    assert.doesNotMatch(form, /<span>WhatsApp<\/span>/);
    assert.doesNotMatch(form, /Invite teammate|tenant_members/);
  });

  it("replaces raw assist and notify dumps with owner lines", () => {
    const got = loadHelpers();
    assert.equal(got.unknown, null);
    assert.equal(got.needsHuman, "Requested owner callback");
    assert.equal(got.resolved, "Resolved");
    assert.equal(got.failed, "Notification retry pending");
    assert.equal(got.caller, "Requested owner callback");
    assert.equal(got.kept, "Escalated to Amina");
    assert.match(ticket, /ownerAssistLabel/);
    assert.match(ticket, /ownerDeskLine/);
    assert.doesNotMatch(ticket, /Assist: \{plainOwnerCopy\(assistLabel\)\}/);
  });
});

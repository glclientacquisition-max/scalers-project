// Admin slice 11a: Businesses table + split pane (ADMIN_V2). Read-only.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const ui = read("dashboard/src/components/admin/v2/AdminBusinessesV2.tsx");
const pane = read("dashboard/src/components/admin/v2/BusinessPane.tsx");
const page = read("dashboard/src/app/admin/(console)/businesses/page.tsx");

function call(expr) {
  const mod = path.join(root, "dashboard/src/lib/ops/businessesView.ts");
  const script = `import * as m from ${JSON.stringify(mod)}; const rows = ${JSON.stringify(ROWS)}; console.log(JSON.stringify(${expr}));`;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}
const row = (id, status, extra = {}) => ({ id, status, business_name: id, package_name: "Starter", sautikit_virtual_number: "+254709221510", whatsapp_notification_number: "+254711000000", billing_enforcement: "off", ...extra });
const ROWS = [row("a", "active"), row("w", "waiting", { sautikit_virtual_number: "pending:w" }), row("s", "suspended"), row("z", "archived")];

describe("businesses views", () => {
  it("opens on Waiting when a business waits for a number", () => {
    assert.equal(call("m.defaultView(rows)"), "waiting");
    assert.equal(call("m.defaultView(rows.filter(r => r.status !== 'waiting'))"), "live");
  });
  it("counts each view", () => {
    assert.deepEqual(call("m.viewCounts(rows)"), { waiting: 1, suspended: 1, live: 1, archived: 1 });
  });
  it("matches name and local or international number forms", () => {
    assert.equal(call("m.matchesQuery(rows[0], '0709221510')"), true);
    assert.equal(call("m.matchesQuery(rows[0], 'start')"), true);
    assert.equal(call("m.matchesQuery(rows[0], 'zzz')"), false);
  });
  it("never shows a pending placeholder as a number", () => {
    assert.equal(call("m.numberLabel(rows[1])"), "None yet");
  });
});

describe("businesses v2 screen", () => {
  it("is behind ADMIN_V2 and keeps the old panel otherwise", () => {
    assert.match(page, /isAdminV2Enabled\(\)/);
    assert.match(page, /AdminBusinessesPanel/);
  });
  it("uses the split pane, a table, and phone rows instead of cards", () => {
    assert.match(ui, /SplitLayout/);
    assert.match(ui, /<BusinessPane/);
    assert.match(pane, /SplitPane/);
    assert.match(ui, /data-businesses-table/);
    assert.match(ui, /data-phone-rows/);
    assert.doesNotMatch(ui, /ListRow|Card/);
  });
  it("makes no writes", () => {
    assert.doesNotMatch(ui, /method:\s*"(POST|PATCH|DELETE)"/);
    assert.deepEqual(ui.match(/fetch\(`[^`]*`/g) || [], []);
    assert.doesNotMatch(pane, /method:\s*"(POST|PATCH|DELETE)"/);
    assert.deepEqual(pane.match(/fetch\(`[^`]*`/g) || [], ["fetch(`/api/admin/businesses/${businessId}/pane`"]);
    const route = read("dashboard/src/app/api/admin/businesses/[id]/pane/route.ts");
    assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
    assert.match(route, /isLegacyAuthenticated/);
  });
  it("names no vendor and no prepaid model on screen", () => {
    const text = (ui + pane).replace(/sautikit_virtual_number/g, "");
    assert.doesNotMatch(text, /sautikit|bachs|elevenlabs|twilio|wallet|prepaid|top.?up/i);
  });
});

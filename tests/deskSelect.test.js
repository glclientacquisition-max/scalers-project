// DeskSelect: themed open list for dark DoD paths (Contacts Sort, SettingsSelect, residual owner).

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("DeskSelect primitive", () => {
  const desk = read("dashboard/src/components/ui/DeskSelect.tsx");

  it("uses Base UI Select with surface+ink open popup tokens", () => {
    assert.match(desk, /from "@base-ui\/react\/select"/);
    assert.match(desk, /export function DeskSelect/);
    assert.match(desk, /bg-surface/);
    assert.match(desk, /text-ink/);
    assert.match(desk, /shadow-menu/);
    assert.match(desk, /border-hairline/);
    assert.match(desk, /data-\[highlighted\]:bg-surface-2/);
    assert.doesNotMatch(desk, /<select[\s>]/);
  });

  it("keeps closed trigger className passthrough for field chrome", () => {
    assert.match(desk, /className/);
    assert.match(desk, /Select\.Trigger/);
    assert.match(desk, /Select\.Popup/);
    assert.match(desk, /Select\.Item/);
  });

  it("wraps portal content in desk-theme so dark tokens resolve under body", () => {
    assert.match(desk, /Select\.Portal/);
    assert.match(desk, /className="desk-theme"/);
    // Popup still uses token utilities that resolve under .desk-theme
    assert.match(desk, /bg-surface/);
    assert.match(desk, /text-ink/);
  });
});

describe("DoD path swaps", () => {
  it("Contacts Sort uses DeskSelect, not a native option list", () => {
    const sort = read("dashboard/src/components/ContactSortSelect.tsx");
    assert.match(sort, /from "@\/components\/ui\/DeskSelect"/);
    assert.match(sort, /<DeskSelect/);
    assert.match(sort, /aria-label="Sort contacts"/);
    assert.match(sort, /label: "Last call"/);
    assert.match(sort, /label: "Name"/);
    assert.doesNotMatch(sort, /<select[\s>]/);
  });

  it("SettingsSelect opens a ChoiceSheet so Tone and Voice drag away", () => {
    const ui = read("dashboard/src/components/settingsUi.tsx");
    const sheet = read("dashboard/src/components/ui/ChoiceSheet.tsx");
    const start = ui.indexOf("export function SettingsSelect");
    assert.ok(start >= 0);
    const chunk = ui.slice(start, start + 1400);
    assert.match(chunk, /<ChoiceSheet/);
    assert.match(chunk, /rowLabel=\{label\}/);
    assert.match(chunk, /detail: opt\.detail/);
    assert.doesNotMatch(chunk, /<select[\s>]/);
    assert.doesNotMatch(chunk, /<DeskSelect/);
    assert.match(sheet, /<Sheet/);
    assert.match(sheet, /aria-haspopup="dialog"/);
    assert.match(sheet, /min-h-11/);
    assert.match(sheet, /CheckIcon/);
    assert.match(sheet, /rowLabel/);
    assert.match(sheet, /text-end text-body/);
  });
});

describe("Residual owner DeskSelect swaps", () => {
  it("TenantForm public contact type + catalog stock + add-rule use DeskSelect", () => {
    const form = read("dashboard/src/components/TenantForm.tsx");
    assert.match(form, /from "@\/components\/ui\/DeskSelect"/);
    assert.match(form, /STOCK_OPTIONS/);
    assert.match(form, /social-kind-m-/);
    assert.match(form, /social-kind-/);
    assert.match(form, /prod-stock-m-/);
    assert.match(form, /prod-stock-/);
    assert.match(form, /add-policy-rule/);
    assert.match(form, /placeholder="Not set"/);
    assert.match(form, /placeholder="Add rule"/);
    assert.doesNotMatch(form, /<select[\s>]/);
  });

  it("PronunciationCoach AI listen batch uses DeskSelect", () => {
    const coach = read("dashboard/src/components/PronunciationCoach.tsx");
    assert.match(coach, /from "@\/components\/ui\/DeskSelect"/);
    assert.match(coach, /aria-label="Calls for AI listen"/);
    assert.match(coach, /gemini-batch/);
    assert.match(coach, /<DeskSelect/);
    assert.doesNotMatch(coach, /<select[\s>]/);
  });

  it("InboxPingTeammate block picker uses DeskSelect", () => {
    const ping = read("dashboard/src/components/InboxPingTeammate.tsx");
    assert.match(ping, /from "@\/components\/ui\/DeskSelect"/);
    assert.match(ping, /aria-label="Teammate"/);
    assert.match(ping, /<DeskSelect/);
    assert.doesNotMatch(ping, /<select[\s>]/);
  });
});

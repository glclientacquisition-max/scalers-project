const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("business settings craft", () => {
  const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  const ui = read("dashboard/src/components/settingsUi.tsx");
  const form = read("dashboard/src/components/TenantForm.tsx");
  const test = read("dashboard/src/components/TestLinePanel.tsx");
  const save = read("dashboard/src/components/TenantSettingsSaveButton.tsx");
  const page = read("dashboard/src/app/(desk)/settings/page.tsx");

  it("keeps Train IA and does not invent Online", () => {
    assert.match(shell, /label: "Assistant"/);
    assert.match(shell, /label: "Team"/);
    assert.match(shell, /pointer-events-none[\s\S]*Train/);
    assert.doesNotMatch(shell, /Agent Persona|Escalation Team/);
    assert.doesNotMatch(shell, /\bOnline\b/);
    assert.doesNotMatch(page, /text-5xl|text-6xl/);
  });

  it("uses Line live / Number pending and assistant field copy", () => {
    assert.match(ui, /Line live/);
    assert.match(ui, /Number pending/);
    assert.match(form, /Assistant name/);
    assert.match(form, /Your assistant will use this on the next call/);
    assert.doesNotMatch(form, /Your receptionist/);
    assert.match(test, /assistant name/);
    assert.doesNotMatch(test, /Agent Persona/);
  });

  it("defines hover, focus, and active on settings primitives", () => {
    assert.match(ui, /SettingsPageHeader/);
    assert.match(ui, /settingsPrimaryButtonClass/);
    assert.match(ui, /hover:border-\[#0096FF\]\/35/);
    assert.match(ui, /active:scale-\[0\.99\]/);
    assert.match(ui, /focus-visible:ring-\[#0096FF\]\/40/);
    assert.match(shell, /min-h-11/);
    assert.match(shell, /active:bg-\[#0096FF\]\/\[0\.08\]/);
    assert.match(save, /active:scale-\[0\.99\]/);
    assert.match(form, /SettingsPageHeader/);
    assert.doesNotMatch(shell, /glass|mesh|MetricCard/);
  });
});

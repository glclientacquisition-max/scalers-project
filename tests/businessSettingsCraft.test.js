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
  const nav = read("dashboard/src/lib/businessSettingsNav.ts");

  it("keeps assistant chrome and does not invent Online", () => {
    assert.match(form, /Assistant name/);
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

  it("groups settings by owner job without new routes", () => {
    assert.match(nav, /id: "general"/);
    assert.match(nav, /id: "knowledge"/);
    assert.match(nav, /id: "operations"/);
    assert.match(nav, /id: "line"/);
    assert.match(nav, /title: "General"/);
    assert.match(nav, /title: "Knowledge"/);
    assert.match(nav, /title: "Operations"/);
    assert.match(nav, /title: "Line"/);
    assert.match(nav, /label: "Updates"/);
    assert.match(nav, /label: "Assistant"/);
    assert.match(nav, /label: "Team"/);
    assert.match(nav, /label: "Catalog"/);
    assert.match(nav, /label: "FAQs"/);
    assert.match(nav, /label: "Import"/);
    assert.match(nav, /label: "Hours"/);
    assert.match(nav, /label: "Locations"/);
    assert.match(nav, /label: "Policies"/);
    assert.match(nav, /label: "Tools & voice"/);
    assert.match(nav, /label: "Pronunciation"/);
    assert.match(nav, /label: "Test"/);
    assert.match(shell, /SETTINGS_NAV/);
    assert.doesNotMatch(shell, />\s*Train\s*</);
    assert.doesNotMatch(nav, /Billing|Security|Appearance/);
    assert.match(nav, /businessSettingsHref\("train"/);
  });

  it("opens /settings as a destination menu, not a dumped form", () => {
    assert.match(nav, /\| "menu"/);
    assert.match(nav, /return "menu"/);
    assert.match(nav, /if \(tab === "menu"\) return "\/settings"/);
    assert.match(shell, /variant: "index" \| "rail"/);
    assert.match(shell, /hidden min-w-0 lg:block/);
    assert.match(shell, /SettingsChevron/);
    assert.match(shell, /min-h-12/);
    assert.match(ui, /SettingsBackLink/);
    assert.match(form, /showBack/);
  });

  it("defines hover, focus, and active on settings primitives", () => {
    assert.match(ui, /SettingsPageHeader/);
    assert.match(ui, /settingsPrimaryButtonClass/);
    assert.match(ui, /hover:border-\[#0096FF\]\/35/);
    assert.match(ui, /active:scale-\[0\.99\]/);
    assert.match(ui, /focus-visible:ring-\[#0096FF\]\/40/);
    assert.match(shell, /active:bg-\[#0096FF\]\/\[0\.08\]/);
    assert.match(save, /active:scale-\[0\.99\]/);
    assert.match(form, /SettingsPageHeader/);
    assert.doesNotMatch(shell, /glass|mesh|MetricCard/);
  });
});

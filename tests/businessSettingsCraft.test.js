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
    assert.doesNotMatch(nav, /Receptionist|receptionist/);
    assert.doesNotMatch(shell, /Receptionist|receptionist/);
    assert.doesNotMatch(test, /Receptionist|receptionist/);
    assert.doesNotMatch(form, /Receptionist|receptionist/);
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

  it("groups settings by owner job without dropping shipped destinations", () => {
    assert.match(nav, /id: "business"/);
    assert.match(nav, /id: "assistant"/);
    assert.match(nav, /id: "knowledge"/);
    assert.match(nav, /id: "alerts"/);
    assert.match(nav, /id: "device"/);
    assert.match(nav, /title: "Business"/);
    assert.match(nav, /title: "Assistant"/);
    assert.doesNotMatch(nav, /label: "Assistant"/);
    assert.doesNotMatch(nav, /id: "receptionist"/);
    assert.doesNotMatch(nav, /title: "Receptionist"/);
    assert.match(nav, /title: "Knowledge"/);
    assert.match(nav, /title: "Alerts"/);
    assert.match(nav, /title: "This device"/);
    assert.match(nav, /label: "Identity"/);
    assert.match(nav, /label: "Hours"/);
    assert.match(nav, /label: "Locations"/);
    assert.match(nav, /label: "Policies"/);
    assert.match(nav, /label: "Voice"/);
    assert.match(nav, /label: "Pronunciation"/);
    assert.match(nav, /label: "Updates"/);
    assert.match(nav, /label: "Test"/);
    assert.match(nav, /label: "FAQs"/);
    assert.match(nav, /label: "Catalog"/);
    assert.match(nav, /label: "Import"/);
    assert.match(nav, /label: "Alerts"/);
    assert.match(nav, /label: "Team"/);
    assert.match(nav, /label: "Appearance"/);
    assert.match(nav, /panel: "identity"/);
    assert.match(nav, /panel: "hours"/);
    assert.match(nav, /panel: "locations"/);
    assert.match(nav, /panel: "policies"/);
    assert.match(nav, /panel: "tools"/);
    assert.match(nav, /panel: "pronunciation"/);
    assert.match(nav, /panel: "faqs"/);
    assert.match(nav, /panel: "team"/);
    assert.match(nav, /tab: "updates"/);
    assert.match(nav, /tab: "test"/);
    assert.match(nav, /tab: "catalog"/);
    assert.match(nav, /tab: "import"/);
    assert.match(nav, /tab: "alerts"/);
    assert.match(nav, /tab: "appearance"/);
    assert.match(nav, /raw === "alerts"/);
    assert.match(nav, /raw === "appearance"/);
    assert.match(shell, /tab === "alerts"/);
    assert.match(shell, /tab === "appearance"/);
    assert.match(shell, /AlertsPanel/);
    assert.match(shell, /AppearancePanel/);
    assert.match(shell, /DailyBulletinPanel/);
    assert.match(shell, /KnowledgeIngestPanel/);
    assert.match(shell, /CatalogImportPanel/);
    assert.match(shell, /TestLinePanel/);
    assert.match(shell, /SETTINGS_NAV/);
    assert.doesNotMatch(shell, />\s*Train\s*</);
    assert.doesNotMatch(nav, /Billing|Security/);
    assert.doesNotMatch(nav, /id: "general"|id: "operations"|id: "line"|id: "receptionist"/);
    assert.match(nav, /businessSettingsHref\("train"/);
    for (const panel of [
      "identity",
      "hours",
      "locations",
      "policies",
      "team",
      "faqs",
      "tools",
      "pronunciation",
      "catalog",
    ]) {
      assert.match(form, new RegExp(`panel === "${panel}"`));
    }
  });

  it("uses non-clickable group headers and a phone index of destination rows", () => {
    assert.match(shell, /SETTINGS_GROUP_TITLE_CLASS/);
    assert.match(shell, /uppercase tracking-wide text-gray-500/);
    assert.match(shell, /pointer-events-none/);
    assert.match(shell, /data-settings-menu=\{variant\}/);
    assert.match(shell, /lg:hidden/);
    assert.match(shell, /SettingsChevron/);
    assert.match(shell, /min-h-12/);
    assert.match(shell, /variant: "index" \| "rail"/);
    assert.match(shell, /hidden min-w-0 lg:block/);
    assert.match(shell, /lg:sticky/);
  });

  it("keeps Sign out on Profile and parks Appearance under This device", () => {
    assert.match(ui, /SignOutButton/);
    assert.match(shell, /SignOutButton/);
    assert.match(shell, /SettingsSignOutRow/);
    assert.match(shell, /<ThemePicker \/>/);
    assert.match(nav, /title: "This device"/);
    assert.match(nav, /label: "Appearance"/);
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

  it("shows catalog cards below md and the table from md up", () => {
    assert.doesNotMatch(form, /className="hidden space-y-3 md:hidden"/);
    assert.match(form, /className="space-y-3 md:hidden"/);
    assert.match(form, /svc-name-m-/);
    assert.match(form, /svc-notes-m-/);
    assert.match(form, /svc-oos-m-/);
    assert.match(form, /prod-name-m-/);
    assert.match(form, /prod-cat-m-/);
    assert.match(form, /className="hidden md:block overflow-hidden rounded-xl border border-line"/);
    assert.match(form, /min-w-\[720px\]/);
    assert.match(form, /min-w-\[640px\]/);
  });

  it("wraps location area and coverage so long values stay readable", () => {
    assert.match(form, /htmlFor={`loc-address-\${index}`}/);
    assert.match(form, /id={`loc-address-\${index}`}/);
    assert.match(form, /id={`loc-coverage-\${index}`}/);
    const addressIdx = form.indexOf("id={`loc-address-${index}`}");
    const coverageIdx = form.indexOf("id={`loc-coverage-${index}`}");
    assert.ok(addressIdx > 0 && coverageIdx > addressIdx);
    assert.match(form.slice(addressIdx - 80, addressIdx + 40), /<ExpandTextarea/);
    assert.match(form.slice(coverageIdx - 80, coverageIdx + 40), /<ExpandTextarea/);
    assert.match(form, /min-w-0 break-words/);
  });

  it("defines hover, focus, and active on settings primitives", () => {
    assert.match(ui, /SettingsPageHeader/);
    assert.match(ui, /settingsPrimaryButtonClass/);
    assert.match(ui, /hover:border-accent\/35/);
    assert.match(ui, /active:scale-\[0\.99\]/);
    assert.match(ui, /focus-visible:ring-accent\/40/);
    assert.match(shell, /active:bg-accent\/\[0\.08\]/);
    assert.match(save, /active:scale-\[0\.99\]/);
    assert.match(form, /SettingsPageHeader/);
    assert.doesNotMatch(shell, /glass|mesh|MetricCard/);
  });
});

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
  const alerts = read("dashboard/src/components/AlertsPanel.tsx");
  const theme = read("dashboard/src/components/ThemePicker.tsx");

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
    assert.match(shell, /settingsGroupTitleClass/);
    assert.match(ui, /uppercase tracking-wide text-gray-500/);
    assert.match(ui, /pointer-events-none/);
    assert.match(shell, /data-settings-menu=\{variant\}/);
    assert.match(shell, /md:hidden/);
    assert.match(shell, /SettingsChevron/);
    assert.match(shell, /min-h-12/);
    assert.match(shell, /variant: "index" \| "rail"/);
    assert.match(shell, /settingsRailWrapClass/);
    assert.match(ui, /hidden min-w-0 shrink-0 md:block md:w-\[13\.5rem\]/);
    assert.match(ui, /md:sticky md:top-4/);
  });

  it("keeps Sign out on Profile and parks Appearance under This device", () => {
    const header = ui.slice(
      ui.indexOf("export function SettingsPageHeader"),
      ui.indexOf("compactTextareaExpandHandlers")
    );
    assert.doesNotMatch(header, /SignOutButton/);
    assert.match(shell, /SignOutButton/);
    assert.match(shell, /SettingsSignOutRow/);
    assert.match(shell, /<ThemePicker \/>/);
    assert.match(shell, /title="This device"/);
    assert.match(nav, /title: "This device"/);
    assert.match(nav, /label: "Appearance"/);
  });

  it("confirms Sign out before POST /api/logout", () => {
    const signOut = read("dashboard/src/components/ui/SignOutButton.tsx");
    assert.match(signOut, /const \[confirming, setConfirming\] = useState\(false\)/);
    assert.match(signOut, /setConfirming\(true\)/);
    assert.match(signOut, /if \(!confirming\)/);
    assert.match(signOut, /Sign out\?/);
    assert.match(signOut, />\s*Stay\s*</);
    assert.match(signOut, /action="\/api\/logout"/);
    assert.match(signOut, /method="post"/);
    assert.match(signOut, /type="submit"/);
    assert.match(signOut, /btnPrimary/);
    assert.match(signOut, /type="button"/);
    assert.doesNotMatch(
      signOut.slice(0, signOut.indexOf("if (!confirming)")),
      /type="submit"/
    );
  });

  it("labels Appearance as This device and persists with scalers-desk-theme", () => {
    const themeLib = read("dashboard/src/lib/deskTheme.ts");
    const layout = read("dashboard/src/app/layout.tsx");
    assert.match(theme, /label="This device"/);
    assert.match(theme, /readDeskTheme/);
    assert.match(theme, /writeDeskTheme/);
    assert.match(themeLib, /export const DESK_THEME_STORAGE_KEY = "scalers-desk-theme"/);
    assert.match(themeLib, /localStorage\.setItem\(DESK_THEME_STORAGE_KEY, choice\)/);
    assert.match(layout, /DESK_THEME_STORAGE_KEY/);
    assert.doesNotMatch(theme, /tenant\.|llm_system_prompt/);
  });

  it("opens /settings as a destination menu, not a dumped form", () => {
    assert.match(nav, /\| "menu"/);
    assert.match(nav, /return "menu"/);
    assert.match(nav, /if \(tab === "menu"\) return "\/settings"/);
    assert.match(shell, /variant: "index" \| "rail"/);
    assert.match(shell, /settingsRailWrapClass/);
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
    assert.match(form, /table-fixed/);
    assert.doesNotMatch(form, /min-w-\[720px\]/);
    assert.doesNotMatch(form, /min-w-\[640px\]/);
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

  it("fills the md canvas with an inner rail and a fluid panel", () => {
    assert.match(shell, /data-settings-console/);
    assert.match(shell, /data-settings-console="" data-desk-nested=""/);
    assert.match(shell, /settingsConsoleClass/);
    assert.match(shell, /settingsPanelClass/);
    assert.match(shell, /settingsRailWrapClass/);
    assert.doesNotMatch(shell, /max-w-5xl|max-w-xl/);
    assert.doesNotMatch(test, /max-w-xl/);
    assert.match(ui, /md:w-\[13\.5rem\]/);
    assert.match(ui, /md:flex-row/);
    assert.match(ui, /grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2/);
    assert.match(ui, /min-w-0 flex-1/);
    assert.match(ui, /text-xl font-semibold/);
    assert.match(form, /SettingsGroup/);
    assert.match(form, /lg:grid-cols-\[minmax\(5\.5rem,7rem\)_3\.5rem_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
    assert.match(form, /lg:grid-cols-\[8rem_minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1\.1fr\)_minmax\(0,1\.1fr\)_2\.5rem\]/);
    assert.match(form, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_auto_2\.5rem\]/);
    assert.match(form, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.2fr\)_2\.5rem\]/);
    assert.match(shell, /border-l-2/);
    assert.match(shell, /border-accent text-accent-deep/);
    const deskNav = read("dashboard/src/components/DeskNav.tsx");
    assert.match(deskNav, /data-settings-console/);
    assert.match(deskNav, /md:has-\[\[data-settings-console\]\]:max-w-none/);
  });

  it("uses native switches for booleans and accent-fill for Save", () => {
    assert.match(ui, /data-settings-toggle/);
    assert.match(ui, /type="checkbox"/);
    assert.match(ui, /role="switch"/);
    assert.match(ui, /min-h-11 min-w-11/);
    assert.match(ui, /bg-accent-fill/);
    assert.match(ui, /focus-within:ring-2 focus-within:ring-accent/);
    assert.match(save, /btnPrimaryFill/);
    assert.match(form, /<ToolSwitch/);
    assert.match(form, /setDayOpen\(day, next\)/);
    assert.match(form, /SettingsSegmented/);
    assert.match(form, /label="When closed"/);
    assert.match(form, /<SettingsSelect/);
    assert.match(alerts, /<ToolSwitch/);
    assert.match(alerts, /ALERTS_SETTINGS_FORM_ID/);
    assert.match(alerts, /form=\{ALERTS_SETTINGS_FORM_ID\}/);
    assert.match(theme, /SettingsSegmented/);
    assert.match(theme, /label="This device"/);
    assert.match(form, /TEAM_NOTIFY_FLAGS/);
    assert.match(form, /settingsTrashButtonClass/);
    assert.doesNotMatch(form, /TEAM_NOTIFY_CHIPS/);
    const ingest = read("dashboard/src/components/KnowledgeIngestPanel.tsx");
    const catalogImport = read("dashboard/src/components/CatalogImportPanel.tsx");
    assert.match(ingest, /\{extractPending \? "Scanning…" : "Scan"\}/);
    assert.match(catalogImport, /\{previewPending \? "Scanning…" : "Scan"\}/);
    assert.doesNotMatch(ingest, /Scan and suggest/);
    assert.match(test, /settingsPrimaryButtonClass/);
    assert.match(test, /Call \{did\}/);
    assert.doesNotMatch(form, /choiceChipClass/);
  });

  it("clears the phone tab bar and keeps Hours When closed in the Hours group", () => {
    assert.match(ui, /settingsPanelClass/);
    assert.match(ui, /pb-\[var\(--desk-tabbar-clearance\)\]/);
    assert.match(form, /title="Hours"/);
    const hoursStart = form.indexOf('title="Hours"');
    const hoursChunk = form.slice(hoursStart, hoursStart + 9000);
    assert.match(hoursChunk, /label="When closed"/);
    assert.match(form, /lg:hidden/);
    assert.doesNotMatch(
      form,
      /grid grid-cols-\[minmax\(5\.5rem,7rem\)_3\.5rem_minmax\(0,1fr\)_minmax\(0,1fr\)\]/
    );
  });

  it("selects Appearance on the hub rail, not Identity", () => {
    const activeFn = nav.slice(
      nav.indexOf("export function settingsNavItemActive"),
      nav.indexOf("export function settingsNavItems")
    );
    assert.match(shell, /selectHubAppearance: true/);
    assert.match(activeFn, /tab === "train" && trainPanel === target\.panel/);
    assert.match(activeFn, /target\.tab === "appearance"/);
    assert.match(activeFn, /tab === "menu"/);
    assert.doesNotMatch(activeFn, /tab === "menu" && trainPanel/);
  });

  it("keeps one filled primary per settings panel", () => {
    const ingest = read("dashboard/src/components/KnowledgeIngestPanel.tsx");
    const catalogImport = read("dashboard/src/components/CatalogImportPanel.tsx");
    const coach = read("dashboard/src/components/PronunciationCoach.tsx");
    assert.match(ingest, /settingsPrimaryButtonClass/);
    assert.match(catalogImport, /settingsActionClass/);
    const catalogScan = catalogImport.slice(
      catalogImport.indexOf("{previewPending ? \"Scanning…\" : \"Scan\"}") - 180,
      catalogImport.indexOf("{previewPending ? \"Scanning…\" : \"Scan\"}") + 40
    );
    assert.match(catalogScan, /settingsActionClass/);
    assert.doesNotMatch(catalogScan, /settingsPrimaryButtonClass/);
    assert.match(form, /panel === "pronunciation" \? undefined/);
    assert.match(coach, /btnPrimary/);
    assert.match(form, /settingsGhostButtonClass/);
    assert.match(form, /Add service/);
    assert.match(form, /Add 3/);
    assert.match(save, /min-h-11/);
    assert.doesNotMatch(save, /min-h-14/);
    assert.doesNotMatch(save, /w-full/);
  });

  it("truncates dense settings tables and uses icon-only team notify", () => {
    assert.match(form, /min-w-0 truncate/);
    assert.match(form, /table-fixed/);
    assert.doesNotMatch(form, /min-w-\[720px\]/);
    assert.doesNotMatch(form, /min-w-\[640px\]/);
    assert.doesNotMatch(form, /minmax\(10rem,auto\)/);
    assert.match(form, /title=\{flag\.label\}/);
    assert.doesNotMatch(
      form,
      /<span className="text-xs font-medium text-ink">\{flag\.label\}<\/span>/
    );
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function loadSettingsNav() {
  const nav = path.join(__dirname, "../dashboard/src/lib/businessSettingsNav.ts");
  const script = `
    import {
      SETTINGS_NAV,
      settingsWideDefaultHref,
      businessSettingsHref,
      parseBusinessSettingsPanel,
    } from ${JSON.stringify(nav)};
    const sections = SETTINGS_NAV.map((section) => ({
      id: section.id,
      title: section.title,
      labels: section.items.map((item) => item.label),
    }));
    console.log(JSON.stringify({
      sections,
      labels: sections.flatMap((section) => section.labels),
      hoursWide: settingsWideDefaultHref(undefined, "1"),
      phoneIndex: settingsWideDefaultHref(undefined, "0"),
      missingCookie: settingsWideDefaultHref(undefined, undefined),
      trainStays: settingsWideDefaultHref("train", "1"),
      testStays: settingsWideDefaultHref("test", "1"),
      trainHref: businessSettingsHref("train"),
      testHref: businessSettingsHref("test"),
      trainPanel: parseBusinessSettingsPanel(undefined, "train"),
    }));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
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
    assert.match(form, /notify\("Saved · training line"\)/);
    assert.doesNotMatch(form, /notify\("Saved"\)/);
    assert.doesNotMatch(form, /Your assistant will use this on the next call/);
    assert.doesNotMatch(form, /Your receptionist/);
    assert.match(test, /previewBusinessAssistantIntro/);
    assert.doesNotMatch(test, /Agent Persona/);
  });

  it("groups settings by owner job without dropping shipped destinations", () => {
    assert.match(nav, /id: "business"/);
    assert.match(nav, /id: "assistant"/);
    assert.match(nav, /id: "knowledge"/);
    assert.match(nav, /id: "people"/);
    assert.doesNotMatch(nav, /id: "offer"/);
    assert.doesNotMatch(nav, /id: "alerts"/);
    assert.doesNotMatch(nav, /id: "device"/);
    assert.match(nav, /title: "Business"/);
    assert.match(nav, /title: "Assistant"/);
    assert.match(nav, /title: "Knowledge"/);
    assert.doesNotMatch(nav, /title: "Offer"/);
    assert.match(nav, /title: "People"/);
    assert.doesNotMatch(nav, /label: "Assistant"/);
    assert.doesNotMatch(nav, /id: "receptionist"/);
    assert.doesNotMatch(nav, /title: "Receptionist"/);
    assert.doesNotMatch(nav, /title: "Alerts"/);
    assert.doesNotMatch(nav, /title: "This device"/);
    assert.match(nav, /label: "Identity"/);
    assert.match(nav, /label: "Hours"/);
    assert.match(nav, /label: "Locations"/);
    assert.match(nav, /label: "Policies"/);
    assert.match(nav, /label: "Voice"/);
    assert.match(nav, /label: "Pronunciation"/);
    assert.doesNotMatch(nav, /label: "Updates"/);
    assert.match(nav, /label: "Test"/);
    assert.match(nav, /label: "FAQs"/);
    assert.match(nav, /label: "Catalog"/);
    assert.match(nav, /label: "Import"/);
    assert.match(nav, /label: "How we notify"/);
    assert.match(nav, /label: "Team"/);
    assert.doesNotMatch(nav, /label: "Appearance"/);
    assert.match(nav, /panel: "identity"/);
    assert.match(nav, /panel: "hours"/);
    assert.match(nav, /panel: "locations"/);
    assert.match(nav, /panel: "policies"/);
    assert.match(nav, /panel: "tools"/);
    assert.match(nav, /panel: "pronunciation"/);
    assert.match(nav, /panel: "faqs"/);
    assert.match(nav, /panel: "team"/);
    assert.doesNotMatch(nav, /tab: "updates"/);
    assert.match(nav, /tab: "test"/);
    assert.match(nav, /tab: "catalog"/);
    assert.match(nav, /tab: "import"/);
    assert.match(nav, /tab: "alerts"/);
    assert.doesNotMatch(nav, /return "Appearance"/);
    assert.match(nav, /raw === "alerts"/);
    assert.doesNotMatch(nav, /raw === "appearance"/);
    assert.match(shell, /tab === "alerts"/);
    assert.doesNotMatch(shell, /tab === "appearance"/);
    assert.match(shell, /AlertsPanel/);
    assert.doesNotMatch(shell, /AppearancePanel/);
    assert.doesNotMatch(shell, /DailyBulletinPanel/);
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
    assert.match(ui, /hidden min-w-0 shrink-0 md:block md:w-max md:max-w-\[13\.5rem\]/);
    assert.match(ui, /md:sticky md:top-4/);
  });

  it("parks Sign out in the account menu and Appearance off the settings index", () => {
    const header = ui.slice(
      ui.indexOf("export function SettingsPageHeader"),
      ui.indexOf("compactTextareaExpandHandlers")
    );
    const account = read("dashboard/src/components/DeskAccountMenu.tsx");
    assert.doesNotMatch(header, /SignOutButton/);
    assert.doesNotMatch(shell, /SignOutButton/);
    assert.doesNotMatch(shell, /SettingsSignOutRow/);
    assert.match(account, /<SignOutButton layout="menu"/);
    assert.match(account, /<ThemePicker \/>/);
    assert.match(account, /data-account-appearance=""/);
    assert.match(account, />\s*This device\s*</);
    assert.doesNotMatch(account, /businessSettingsHref\("appearance"\)/);
    assert.doesNotMatch(account, /href=.*\/settings/);
    assert.doesNotMatch(account, />\s*Profile\s*</);
    assert.doesNotMatch(shell, /<ThemePicker \/>/);
    assert.doesNotMatch(shell, /title="This device"/);
    assert.doesNotMatch(shell, /tab === "appearance"/);
    assert.match(page, /tabRaw === "appearance"\) redirect\("\/settings"\)/);
    const redirectAt = page.indexOf('tabRaw === "appearance"');
    const tenantAt = page.indexOf("getCurrentTenant()");
    assert.ok(redirectAt > 0 && tenantAt > redirectAt);
    assert.doesNotMatch(nav, /title: "This device"/);
    assert.doesNotMatch(nav, /label: "Appearance"/);
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
    assert.match(theme, /aria-label="This device"/);
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

  it("shows dense catalog rows below lg and the table from lg", () => {
    assert.doesNotMatch(form, /rounded-xl border border-line bg-surface p-3/);
    assert.match(form, /lg:hidden/);
    assert.match(form, /svc-name-m-/);
    assert.match(form, /svc-notes-m-/);
    assert.match(form, /svc-oos-m-/);
    assert.match(form, /prod-name-m-/);
    assert.match(form, /prod-cat-m-/);
    assert.match(form, /className="hidden overflow-hidden rounded-xl border border-line lg:block"/);
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
    assert.match(ui, /md:w-max md:max-w-\[13\.5rem\]/);
    assert.match(ui, /md:flex-row/);
    assert.match(ui, /grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2/);
    assert.match(ui, /min-w-0 flex-1/);
    assert.match(ui, /text-xl font-semibold/);
    assert.match(form, /SettingsGroup/);
    assert.match(form, /lg:grid-cols-\[minmax\(5\.5rem,7rem\)_3\.5rem_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
    assert.match(form, /grid-cols-\[minmax\(0,7rem\)_minmax\(0,1fr\)_2\.75rem_2\.75rem\]/);
    assert.match(form, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_auto_2\.5rem\]/);
    assert.match(form, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.2fr\)_2\.75rem\]/);
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
    assert.match(theme, /role="radiogroup"/);
    assert.match(theme, /aria-label="This device"/);
    assert.match(theme, /data-theme-cluster=""/);
    assert.doesNotMatch(theme, /SettingsSegmented/);
    assert.match(ui, /deskRateCardClass/);
    assert.match(ui, /deskRateCardRowClass/);
    assert.doesNotMatch(ui, /filterTabClass/);
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

  it("orders jobs and keeps Team out of the How we notify group", () => {
    const got = loadSettingsNav();
    assert.deepEqual(got.labels, [
      "Identity",
      "Hours",
      "Locations",
      "Policies",
      "Catalog",
      "Import",
      "FAQs",
      "Voice",
      "Pronunciation",
      "Test",
      "Team",
      "How we notify",
    ]);
    assert.deepEqual(
      got.sections.map((section) => section.title),
      ["Business", "Knowledge", "Assistant", "People"]
    );
    assert.equal(new Set(got.sections.map((section) => section.id)).size, got.sections.length);
    assert.equal(got.labels[got.labels.indexOf("Catalog") + 1], "Import");
    assert.equal(got.labels.indexOf("Identity") + 1, got.labels.indexOf("Hours"));
    const people = got.sections.find((section) => section.title === "People");
    assert.deepEqual(people.labels, ["Team", "How we notify"]);
    assert.equal(people.id, "people");
    assert.notEqual(people.id, "alerts");
    assert.equal(got.sections.some((section) => section.title === "How we notify" || section.title === "Alerts" || section.id === "alerts"), false);
    assert.equal(got.hoursWide, "/settings?tab=train&panel=hours");
    assert.equal(got.phoneIndex, null);
    assert.equal(got.missingCookie, null);
    assert.equal(got.trainStays, null);
    assert.equal(got.testStays, null);
    assert.equal(got.trainHref, "/settings?tab=train");
    assert.equal(got.testHref, "/settings?tab=test");
    assert.equal(got.trainPanel, "identity");
  });

  it("opens wide /settings on Hours and does not mount Identity on the index", () => {
    const boot = read("dashboard/src/lib/deskMdBoot.ts");
    const layout = read("dashboard/src/app/layout.tsx");
    const activeFn = nav.slice(
      nav.indexOf("export function settingsNavItemActive"),
      nav.indexOf("export function settingsNavItems")
    );
    const menu = shell.slice(shell.indexOf("if (isMenu)"), shell.indexOf("const rail ="));
    assert.match(page, /settingsWideDefaultHref/);
    assert.ok(page.indexOf("settingsWideDefaultHref") < page.indexOf("getCurrentTenant()"));
    assert.match(page, /if \(!tabRaw\)/);
    assert.match(nav, /export const SETTINGS_HOURS_HREF = businessSettingsHref\("train", "hours"\)/);
    assert.match(nav, /if \(deskMd !== "1"\) return null/);
    assert.match(boot, /min-width: 768px/);
    assert.match(boot, /location\.search/);
    assert.match(boot, /SETTINGS_HOURS_HREF/);
    assert.match(layout, /DESK_MD_BOOT_SCRIPT/);
    assert.doesNotMatch(shell, /SettingsIdentityRedirect/);
    assert.doesNotMatch(shell, /panel=identity/);
    assert.doesNotMatch(shell, /panel="identity"/);
    assert.doesNotMatch(shell, /selectHubIdentity/);
    assert.doesNotMatch(menu, /TenantForm/);
    assert.match(menu, /md:hidden/);
    assert.match(activeFn, /tab === "train" && trainPanel === target\.panel/);
    assert.doesNotMatch(activeFn, /selectHubIdentity/);
    assert.doesNotMatch(shell, /selectHubAppearance/);
    assert.doesNotMatch(shell, /<AppearancePanel \/>/);
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
    assert.match(form, /Saves live - no sticky Save/);
    assert.doesNotMatch(form, /panel === "pronunciation" \? undefined/);
    assert.match(coach, /btnPrimary/);
    assert.match(coach, /fixHasUsePrimary/);
    assert.match(form, /settingsGhostButtonClass/);
    assert.match(form, /Add service/);
    assert.match(form, /Add 3 blank rows/);
    assert.match(save, /min-h-11/);
    assert.doesNotMatch(save, /min-h-14/);
    assert.doesNotMatch(save, /w-full/);
    // Team: callback-only must not mount a filled handoff chip beside Save (#514).
    const team = form.slice(
      form.indexOf('panel === "team"'),
      form.indexOf('panel === "faqs"')
    );
    assert.doesNotMatch(team, /HANDOFF_OPTIONS/);
    assert.doesNotMatch(team, /SettingsSegmented/);
    assert.doesNotMatch(team, /Message teammate/);
    assert.doesNotMatch(team, /btnPrimaryFill|settingsPrimaryButtonClass/);
    assert.doesNotMatch(team, /deskRateCardClass/);
  });

  it("truncates dense settings tables and labels team notify", () => {
    assert.match(form, /min-w-0 truncate/);
    assert.match(form, /table-fixed/);
    assert.doesNotMatch(form, /min-w-\[720px\]/);
    assert.doesNotMatch(form, /min-w-\[640px\]/);
    assert.doesNotMatch(form, /minmax\(10rem,auto\)/);
    assert.match(form, /\{flag\.label\}/);
    assert.match(form, /label: "Urgent"/);
    assert.match(form, /label: "Follow-up"/);
    assert.match(form, /label: "Ops"/);
    assert.match(form, /Channels follow How we notify\./);
    assert.doesNotMatch(form, /label: "SMS"/);
    assert.doesNotMatch(form, /label: "WhatsApp"/);
    assert.doesNotMatch(form, /label: "Email"/);
    assert.doesNotMatch(form, /title=\{flag\.label\}/);
    assert.doesNotMatch(form, /Invite teammate|tenant_members/);
    const team = form.slice(
      form.indexOf('panel === "team"'),
      form.indexOf('panel === "faqs"')
    );
    assert.match(team, /<span>Role<\/span>/);
    assert.match(team, />\s*Role\s*</);
    assert.doesNotMatch(team, /Handles/);
    // Batch B: email/name carry title + wrap — no silent truncate data loss.
    assert.match(team, /title=\{member\.email \|\| undefined\}/);
    assert.match(team, /title=\{member\.name \|\| undefined\}/);
    assert.match(team, /break-words \[overflow-wrap:anywhere\]/);
    assert.doesNotMatch(team, /min-w-0 truncate/);
  });

  it("recovers empty Policies/Test and clarifies Identity truncation", () => {
    const policies = form.slice(
      form.indexOf('panel === "policies"'),
      form.indexOf('panel === "tools"')
    );
    assert.match(policies, /No rules yet\. Add payment or cancellation/);
    assert.match(policies, /openPolicyIds\.length === 0/);
    assert.doesNotMatch(policies, /M-Pesa Paybill|30% deposit required/);

    assert.match(test, /Add a business name in/);
    assert.match(test, /businessSettingsHref\("train", "identity"\)/);
    assert.match(test, /to preview the greeting/);

    assert.match(form, /id="business_name"[\s\S]*title=\{businessName/);
    assert.match(ui, /title=\{businessName\}/);
    assert.match(ui, /break-words text-sm font-medium text-ink/);
    assert.match(shell, /title=\{status\}/);
    assert.match(form, /title="Add 3 blank rows"/);
  });

  it("packs Profile sub-strips instead of stretching them across the pane", () => {
    const segmented = ui.slice(
      ui.indexOf("export function SettingsSegmented"),
      ui.indexOf("export function SettingsSelect")
    );
    assert.match(segmented, /data-settings-strip=/);
    assert.match(segmented, /deskRateCardRowClass/);
    assert.match(segmented, /deskRateCardClass/);
    assert.match(segmented, /snap-start shrink-0/);
    assert.doesNotMatch(segmented, /justify-between/);
    assert.doesNotMatch(segmented, /flex-1/);
    assert.doesNotMatch(segmented, /w-full min-w-0 border-b/);

    assert.match(ui, /md:justify-start md:gap-4/);
    assert.doesNotMatch(
      ui.slice(
        ui.indexOf("export const settingsConsoleClass"),
        ui.indexOf("export const settingsRailWrapClass")
      ),
      /justify-between|flex-1|md:gap-8/
    );

    const rail = shell.slice(
      shell.indexOf("const isRail = variant === \"rail\""),
      shell.indexOf("const railLinkClass") + "const railLinkClass".length + 240
    );
    assert.match(rail, /inline-flex min-h-11 w-full items-center justify-start/);
    assert.match(rail, /w-max max-w-full space-y-0.5/);
    assert.doesNotMatch(rail, /justify-between/);
    assert.doesNotMatch(rail, /flex-1/);
    assert.doesNotMatch(rail, /mt-6/);

    const coach = read("dashboard/src/components/PronunciationCoach.tsx");
    const tablistStart = coach.indexOf('aria-label="Pronunciation studio modes"');
    const tablist = coach.slice(tablistStart - 220, tablistStart + 420);
    assert.match(tablist, /data-settings-strip=/);
    assert.match(tablist, /inline-flex max-w-full justify-start gap-1/);
    assert.match(tablist, /overflow-x-auto/);
    assert.doesNotMatch(tablist, /justify-between/);
    assert.doesNotMatch(tablist, /flex-1/);
    assert.doesNotMatch(tablist, /flex-wrap gap-1 border-b/);
  });
});

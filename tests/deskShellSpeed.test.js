const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function load(rel, expr) {
  const file = path.join(__dirname, "..", rel);
  const script = `
    import * as mod from ${JSON.stringify(file)};
    const value = ${expr};
    process.stdout.write(JSON.stringify(value));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
}

describe("desk shell speed", () => {
  const layout = read("dashboard/src/app/(desk)/layout.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const inbox = read("dashboard/src/app/(desk)/calls/page.tsx");
  const settings = read("dashboard/src/app/(desk)/settings/page.tsx");

  it("gates chrome on the cookie and a thin tenant, then suspends the page slot", () => {
    assert.match(layout, /getAuthUser\(\)/);
    assert.match(layout, /getDeskShellTenant/);
    assert.doesNotMatch(layout, /getCurrentTenant/);
    assert.match(layout, /tenantNeedsOnboarding/);
    assert.match(layout, /redirect\("\/login"\)/);
    assert.match(layout, /redirect\("\/onboarding"\)/);
    assert.match(layout, /<DeskRail \/>/);
    assert.match(layout, /<DeskTabBar \/>/);
    assert.doesNotMatch(layout, /fallback=\{<DeskRail/);
    assert.doesNotMatch(layout, /fallback=\{<DeskTabBar/);
    assert.match(layout, /fallback=\{<DeskPageSkeleton \/>\}/);
    assert.equal(
      fs.existsSync(path.join(__dirname, "..", "dashboard/src/app/(desk)/loading.tsx")),
      false
    );
  });

  it("logs shell, Overview, and Inbox phase timings", () => {
    assert.match(layout, /timer\.line\("desk-shell"\)/);
    assert.match(home, /timer\.line\("home"\)/);
    assert.match(inbox, /timer\.line\("inbox"\)/);
    const line = load(
      "dashboard/src/lib/deskTiming.ts",
      `(function () {
        const timer = mod.createDeskTimer();
        timer.mark("auth");
        timer.mark("shell");
        return timer.line("desk-shell");
      })()`
    );
    assert.match(line, /^desk-timing route=desk-shell auth;dur=\d+,shell;dur=\d+$/);
  });

  it("paints a page skeleton on a desk tap without a route loading file", () => {
    const pages = [
      "dashboard/src/app/(desk)/home/page.tsx",
      "dashboard/src/app/(desk)/calls/page.tsx",
      "dashboard/src/app/(desk)/contacts/page.tsx",
      "dashboard/src/app/(desk)/wallet/page.tsx",
      "dashboard/src/app/(desk)/settings/page.tsx",
      "dashboard/src/app/(desk)/calls/[id]/page.tsx",
      "dashboard/src/app/(desk)/contacts/[id]/page.tsx",
    ];
    for (const rel of pages) {
      const src = read(rel);
      assert.match(src, /DeskPageGate/);
      assert.doesNotMatch(src, /export const instant = false/);
    }
    assert.match(layout, /export const instant = false/);
    assert.match(layout, /DeskPendingSlot/);
    const nav = read("dashboard/src/components/DeskNavState.tsx");
    assert.match(nav, /DeskPageSkeleton/);
    assert.match(nav, /invisible absolute/);
    assert.doesNotMatch(nav, /hidden=\{/);
    assert.match(read("dashboard/src/components/DeskPageGate.tsx"), /DeskPageCommit/);
    assert.match(read("dashboard/src/app/(desk)/error.tsx"), /type: "error"/);
    assert.match(read("dashboard/src/components/DeskNav.tsx"), /type: "link-idle"/);
    assert.equal(
      fs.existsSync(path.join(__dirname, "..", "dashboard/src/app/(desk)/loading.tsx")),
      false
    );
  });

  it("loads the voice catalog only for Voice and Test", () => {
    assert.match(settings, /tab === "test" \|\| \(tab === "train" && trainPanel === "tools"\)/);
    assert.match(settings, /tenantForSettingsView/);
  });

  it("keeps a stored offer blob when the active panel does not own the catalog", () => {
    const actions = read("dashboard/src/app/(desk)/settings/actions.ts");
    const form = read("dashboard/src/components/TenantForm.tsx");
    assert.match(form, /name="settings_scope"/);
    assert.match(actions, /pick\(\s*"servicesCatalog"/);
    assert.match(actions, /pick\(\s*"hoursSchedule"/);
  });

  it("keeps the prompt and catalogs off a Hours view", () => {
    const view = load(
      "dashboard/src/lib/settingsPanelPayload.ts",
      `mod.tenantForSettingsView({
        id: "t1",
        business_name: "Westlands Books",
        sautikit_virtual_number: "+254700000000",
        whatsapp_notification_number: "+254711111111",
        llm_system_prompt: "a".repeat(4000),
        services_catalog: [{ name: "Delivery" }],
        product_catalog: [{ name: "Couch" }],
        faqs: [{ question: "Hours?", answer: "Nine" }],
        services_offered: "Services:\\nDelivery",
        business_hours: "Mon 9-5",
        agent_tone: "warm"
      }, "train", "hours")`
    );
    assert.equal(view.llm_system_prompt, null);
    assert.deepEqual(view.services_catalog, []);
    assert.deepEqual(view.product_catalog, []);
    assert.deepEqual(view.faqs, []);
    assert.equal(view.services_offered, "");
    assert.equal(view.business_name, "Westlands Books");
  });

  it("keeps catalogs on the Catalog view", () => {
    const view = load(
      "dashboard/src/lib/settingsPanelPayload.ts",
      `mod.tenantForSettingsView({
        id: "t1",
        business_name: "Westlands Books",
        sautikit_virtual_number: "+254700000000",
        whatsapp_notification_number: "+254711111111",
        llm_system_prompt: "prompt",
        services_catalog: [{ name: "Delivery" }],
        product_catalog: [{ name: "Couch" }],
        services_offered: "Services:\\nDelivery"
      }, "catalog", "identity")`
    );
    assert.equal(view.llm_system_prompt, null);
    assert.equal(view.services_catalog[0].name, "Delivery");
    assert.equal(view.product_catalog[0].name, "Couch");
  });
});

describe("desk tap skeleton", () => {
  it("holds the skeleton after the URL changes until the page body commits", () => {
    const held = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref("/calls", { type: "link-idle", href: "/calls", pathname: "/calls" })`
    );
    assert.equal(held, "/calls");
    const committed = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref("/calls", { type: "committed", pathname: "/calls", concealed: false })`
    );
    assert.equal(committed, null);
  });

  it("keeps the skeleton when a concealed page commits", () => {
    const kept = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref("/calls", { type: "committed", pathname: "/calls", concealed: true })`
    );
    assert.equal(kept, "/calls");
  });

  it("does not let the previous page clear the next tap", () => {
    const kept = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref("/calls", { type: "committed", pathname: "/settings", concealed: false })`
    );
    assert.equal(kept, "/calls");
  });

  it("clears a tap that never left the current page", () => {
    const cleared = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref("/calls", { type: "link-idle", href: "/calls", pathname: "/settings" })`
    );
    assert.equal(cleared, null);
  });

  it("does not re-arm the skeleton after the URL has arrived", () => {
    const armed = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref(null, { type: "start", href: "/calls", pathname: "/settings" })`
    );
    assert.equal(armed, "/calls");
    const stayed = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref(null, { type: "start", href: "/calls", pathname: "/calls" })`
    );
    assert.equal(stayed, null);
  });

  it("clears the skeleton when the page errors", () => {
    const cleared = load(
      "dashboard/src/lib/deskPending.ts",
      `mod.nextDeskPendingHref("/calls", { type: "error" })`
    );
    assert.equal(cleared, null);
  });
});

describe("settings save scope", () => {
  it("keeps stored catalogs when Hours is the scope", () => {
    const kept = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("hours", "servicesCatalog", [], [{ name: "Delivery" }])`
    );
    assert.deepEqual(kept, [{ name: "Delivery" }]);
  });

  it("takes the form hours when Hours is the scope", () => {
    const hours = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("hours", "hoursSchedule", { days: { mon: { open: "09:00", close: "17:00" } } }, null)`
    );
    assert.equal(hours.days.mon.open, "09:00");
  });

  it("keeps the submitted form when the scope is unknown", () => {
    const name = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("", "businessName", "From form", "Stored")`
    );
    assert.equal(name, "From form");
  });

  it("keeps the stored lexicon on Voice and strips it from Hours", () => {
    const lexicon = [{ match: "aisha", say: "Eye-sha", label: "Aisha" }];
    const voice = load(
      "dashboard/src/lib/settingsPanelPayload.ts",
      `mod.tenantForSettingsView({
        id: "t1",
        business_name: "Westlands Books",
        tts_lexicon: ${JSON.stringify(lexicon)}
      }, "train", "tools")`
    );
    assert.equal(voice.tts_lexicon[0].say, "Eye-sha");
    const hours = load(
      "dashboard/src/lib/settingsPanelPayload.ts",
      `mod.tenantForSettingsView({
        id: "t1",
        business_name: "Westlands Books",
        tts_lexicon: ${JSON.stringify(lexicon)}
      }, "train", "hours")`
    );
    assert.deepEqual(hours.tts_lexicon, []);
    const pronunciation = load(
      "dashboard/src/lib/settingsPanelPayload.ts",
      `mod.tenantForSettingsView({
        id: "t1",
        business_name: "Westlands Books",
        tts_lexicon: ${JSON.stringify(lexicon)}
      }, "train", "pronunciation")`
    );
    assert.equal(pronunciation.tts_lexicon[0].label, "Aisha");
  });

  it("does not let a Voice save overwrite the lexicon", () => {
    const kept = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("tools", "ttsLexicon", [], [{ match: "aisha", say: "Eye-sha" }])`
    );
    assert.deepEqual(kept, [{ match: "aisha", say: "Eye-sha" }]);
    const owned = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("pronunciation", "ttsLexicon", [{ match: "aisha", say: "Eye-sha" }], [])`
    );
    assert.equal(owned[0].say, "Eye-sha");
  });

  it("does not let a Voice save overwrite team, catalogs, or FAQs", () => {
    const team = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("tools", "teamDirectory", [], [{ name: "Wanjiku" }])`
    );
    assert.deepEqual(team, [{ name: "Wanjiku" }]);
    const handoff = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("tools", "handoffMode", "callback", "live_transfer")`
    );
    assert.equal(handoff, "live_transfer");
    const catalogs = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("tools", "servicesCatalog", [], [{ name: "Delivery" }])`
    );
    assert.deepEqual(catalogs, [{ name: "Delivery" }]);
    const products = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("tools", "productCatalog", [], [{ name: "Atlas" }])`
    );
    assert.deepEqual(products, [{ name: "Atlas" }]);
    const faqs = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("tools", "faqs", [], [{ q: "Hours?", a: "Nine to five." }])`
    );
    assert.equal(faqs[0].q, "Hours?");
    const teamOwnsHandoff = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("team", "handoffMode", "live_transfer", "callback")`
    );
    assert.equal(teamOwnsHandoff, "live_transfer");
  });

  it("does not let Identity overwrite places or policies", () => {
    const places = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("identity", "businessLocations", [{ address: "Form" }], [{ address: "Stored" }])`
    );
    assert.deepEqual(places, [{ address: "Stored" }]);
    const policies = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("identity", "businessPolicies", { delivery: "Form" }, { delivery: "Stored" })`
    );
    assert.equal(policies.delivery, "Stored");
  });

  it("lets Locations own the hours location line and keeps Hours off it", () => {
    const fromLocations = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("locations", "locationNotes", "Parklands", "Westlands")`
    );
    assert.equal(fromLocations, "Parklands");
    const fromHours = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsFieldFromScope("hours", "locationNotes", "Parklands", "Westlands")`
    );
    assert.equal(fromHours, "Westlands");
  });

  const invalidEverywhere = {
    businessName: "",
    agentName: "A".repeat(41),
    servicesCatalogCount: 0,
    productCatalogCount: 0,
    servicesOfferedLength: 0,
    productCatalogMax: 500,
    hasSchedule: false,
    businessHoursLength: 0,
    hasTone: false,
    teamCount: 30,
    faqCount: 30,
    submittedVoiceId: "not-a-voice",
    resolvedVoiceId: null,
    voiceLabel: "x".repeat(41),
  };

  it("fails a Hours save only for hours", () => {
    const err = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("hours", ${JSON.stringify(invalidEverywhere)})`
    );
    assert.equal(err, "Set at least one open day.");
    const ok = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("hours", ${JSON.stringify({
        ...invalidEverywhere,
        hasSchedule: true,
        businessHoursLength: 24,
      })})`
    );
    assert.equal(ok, null);
  });

  it("fails a Voice save only for voice fields", () => {
    const err = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("tools", ${JSON.stringify(invalidEverywhere)})`
    );
    assert.equal(err, "Pick a voice from the list.");
    const label = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("tools", ${JSON.stringify({
        ...invalidEverywhere,
        submittedVoiceId: "",
        resolvedVoiceId: null,
      })})`
    );
    assert.equal(label, "Voice label should be under 40 characters.");
    const ok = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("tools", ${JSON.stringify({
        ...invalidEverywhere,
        submittedVoiceId: "",
        voiceLabel: "Shop voice",
      })})`
    );
    assert.equal(ok, null);
  });

  it("names assistant and FAQ limits without another panel's error", () => {
    const faqs = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("faqs", ${JSON.stringify(invalidEverywhere)})`
    );
    assert.equal(faqs, "FAQs are limited to 25 pairs.");
    const name = load(
      "dashboard/src/lib/settingsSaveScope.ts",
      `mod.settingsScopeValidationError("identity", ${JSON.stringify({
        ...invalidEverywhere,
        businessName: "Westlands Books",
        hasTone: true,
      })})`
    );
    assert.equal(name, "Assistant name should be under 40 characters.");
  });

  it("clears an emptied alert phone and says Saved only when the write matches", () => {
    const cleared = load(
      "dashboard/src/lib/alertsSave.ts",
      `mod.alertPhoneWrite("")`
    );
    assert.equal(cleared, "");
    const mismatch = load(
      "dashboard/src/lib/alertsSave.ts",
      `mod.alertsPersistMatchesSubmit({ submittedPhone: "", writtenPhone: "+254711111111", submittedEmail: "", writtenEmail: null })`
    );
    assert.equal(mismatch, false);
    const match = load(
      "dashboard/src/lib/alertsSave.ts",
      `mod.alertsPersistMatchesSubmit({ submittedPhone: "", writtenPhone: "", submittedEmail: "", writtenEmail: null })`
    );
    assert.equal(match, true);
    const actions = read("dashboard/src/app/(desk)/settings/alertsActions.ts");
    assert.match(actions, /alertPhoneWrite\(submittedPhone\)/);
    assert.match(actions, /alertsPersistMatchesSubmit/);
    assert.doesNotMatch(
      actions,
      /tenant\.whatsapp_notification_number/
    );
    assert.match(actions, /whatsapp_notification_number: writtenPhone/);
  });

  it("keeps panel copy on the job and off invented FAQ answers", () => {
    const form = read("dashboard/src/components/TenantForm.tsx");
    const save = read("dashboard/src/components/TenantSettingsSaveButton.tsx");
    const catalog = read("dashboard/src/app/(desk)/settings/catalogActions.ts");
    const ingest = read("dashboard/src/app/(desk)/settings/ingestActions.ts");
    assert.match(save, /\bSave\b/);
    assert.match(save, /Saving/);
    assert.doesNotMatch(save, /Save and train|Training/);
    assert.doesNotMatch(form, /Voice option \d/);
    assert.doesNotMatch(form, /FAQ_STARTERS/);
    assert.doesNotMatch(form, /free parking behind the building/);
    assert.match(form, /displaySonioxVoiceLabel\("", voice\.id, voiceOptions\)/);
    assert.doesNotMatch(catalog, /Open Train to review/);
    assert.doesNotMatch(ingest, /Open Train to review/);
    assert.match(catalog, /Catalogue saved for the next call/);
    assert.match(ingest, /Catalogue saved for the next call/);
    assert.match(read("dashboard/src/app/(desk)/settings/actions.ts"), /settingsScopeValidationError/);
  });

  it("puts one short status on the settings list and does not mount the form on the phone index", () => {
    const hours = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "train", panel: "hours" }, { hours_schedule: { days: { mon: { open: "09:00", close: "17:00" }, tue: { open: "09:00", close: "17:00" } } } })`
    );
    assert.equal(hours, "2 days");
    const voice = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "train", panel: "tools" }, { soniox_voice_label: "Shop voice" }, [])`
    );
    assert.equal(voice, "Shop voice");
    const identityBiz = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "train", panel: "identity" }, { business_name: "Done and Dusted", agent_name: "Shy", soniox_voice_label: "Shy" }, [])`
    );
    assert.equal(identityBiz, "Done and Dusted");
    const identityTone = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "train", panel: "identity" }, { agent_name: "Shy", agent_tone: "warm", soniox_voice_label: "Shy" }, [])`
    );
    assert.equal(identityTone, "Warm");
    const identityCollision = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "train", panel: "identity" }, { agent_name: "Shy", soniox_voice_label: "Shy" }, [])`
    );
    assert.equal(identityCollision, "");
    const voiceKeepsLabel = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "train", panel: "tools" }, { agent_name: "Shy", soniox_voice_label: "Shy" }, [])`
    );
    assert.equal(voiceKeepsLabel, "Shy");
    const line = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "test" }, { sautikit_virtual_number: "+254700000000" })`
    );
    assert.equal(line, "Line live");
    const pending = load(
      "dashboard/src/lib/settingsOptionStatus.ts",
      `mod.settingsOptionStatus({ tab: "test" }, { sautikit_virtual_number: "pending:1" })`
    );
    assert.equal(pending, "");
    const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
    // Phone index is md:hidden menu; form mounts only after drill-in (isMenu early return).
    assert.match(shell, /if \(isMenu\)/);
    assert.match(shell, /md:hidden/);
    assert.match(shell, /variant="index"/);
    assert.match(shell, /data-settings-menu=\{variant\}/);
    assert.doesNotMatch(shell, /overflow-hidden rounded-xl border border-line bg-surface/);
  });
});

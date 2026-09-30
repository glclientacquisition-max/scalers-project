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
});

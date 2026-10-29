const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const remakes = [
  {
    name: "Packages",
    ui: "dashboard/src/components/admin/v2/AdminPackagesV2.tsx",
    screen: "dashboard/src/app/admin/(console)/_screens/PackagesScreen.tsx",
    dev: "dashboard/src/app/dev/admin-packages-v2/page.tsx",
    tabs: "ADMIN_BILLING_TABS",
  },
  {
    name: "Services",
    ui: "dashboard/src/components/admin/v2/AdminServicesV2.tsx",
    screen: "dashboard/src/app/admin/(console)/_screens/ServicesScreen.tsx",
    dev: "dashboard/src/app/dev/admin-services-v2/page.tsx",
    tabs: "ADMIN_SETTINGS_TABS",
  },
  {
    name: "Voices",
    ui: "dashboard/src/components/admin/v2/AdminVoicesV2.tsx",
    screen: "dashboard/src/app/admin/(console)/_screens/VoicesScreen.tsx",
    dev: "dashboard/src/app/dev/admin-voices-v2/page.tsx",
    tabs: "ADMIN_SETTINGS_TABS",
  },
  {
    name: "Audit",
    ui: "dashboard/src/components/admin/v2/AdminAuditV2.tsx",
    screen: "dashboard/src/app/admin/(console)/_screens/AuditScreen.tsx",
    dev: "dashboard/src/app/dev/admin-audit-v2/page.tsx",
    tabs: "ADMIN_SETTINGS_TABS",
  },
];

for (const r of remakes) {
  test(`${r.name} v2: ops shell, Unlock, no ReasonedSwitch, ADMIN_V2 wire`, () => {
    const ui = read(r.ui);
    const screen = read(r.screen);
    const dev = read(r.dev);
    assert.doesNotMatch(ui, /ReasonedSwitch/, r.name);
    assert.match(ui, /ops-theme/, r.name);
    if (r.name !== "Audit") {
      assert.match(ui, /useAdminUnlockSession|data-stepup=/, r.name);
      assert.match(read("dashboard/src/components/admin/AdminHeaderUnlock.tsx"), /Unlock/);
    }
    assert.match(screen, /isAdminV2Enabled\(\)/, r.name);
    assert.match(screen, new RegExp(`Admin${r.name === "Audit" ? "Audit" : r.name}V2`), r.name);
    assert.match(dev, /AdminShell[^>]*v2/, r.name);
    assert.match(dev, new RegExp(r.tabs), r.name);
  });
}

test("remakes ban vendor and engineering copy on screen", () => {
  for (const r of remakes) {
    // Strip imports and block comments; assert only what can reach the screen.
    const ui = read(r.ui)
      .replace(/^import[\s\S]*?;$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(ui, /["'`][^"'`]*(Supabase|Vercel|Soniox|ReasonedSwitch|SkeletonList)[^"'`]*["'`]/i, r.name);
    assert.doesNotMatch(ui, />[^<]*(Supabase|Vercel|Soniox|ReasonedSwitch|SkeletonList)[^<]*</i, r.name);
  }
});

test("Packages remake is catalog write after Unlock, not note-only", () => {
  const ui = read("dashboard/src/components/admin/v2/AdminPackagesV2.tsx");
  assert.match(ui, /useAdminUnlockSession/);
  assert.match(ui, /"Locked"/);
  assert.match(ui, /\/api\/admin\/package-versions/);
  assert.doesNotMatch(ui, /Secure sign-in is next|Packages remake\. Observe only/);
});

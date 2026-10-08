"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const linksPath = path.join(ROOT, "dashboard/src/lib/adminLinks.ts");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function loadParents() {
  const script = `
    import { adminParentTarget, adminPhoneMore, adminPhoneTabs, ADMIN_LINKS } from ${JSON.stringify(linksPath)};
    const cases = {
      overview: adminParentTarget("/admin"),
      billingClient: adminParentTarget("/admin/billing/abc"),
      wallets: adminParentTarget("/admin/wallets"),
      ledgerNested: adminParentTarget("/admin/wallets/abc"),
      businesses: adminParentTarget("/admin/businesses"),
      nested: adminParentTarget("/admin/businesses/abc"),
      unknown: adminParentTarget("/admin/ops/extra"),
      query: adminParentTarget("/admin/voices/1?x=1"),
      labels: ADMIN_LINKS.map((item) => item.label),
      phoneTabs: adminPhoneTabs().map((item) => item.label),
      phoneMore: adminPhoneMore().map((item) => item.label),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("admin desk standard shell", () => {
  const adminNav = read("dashboard/src/components/AdminNav.tsx");
  const deskNav = read("dashboard/src/components/DeskNav.tsx");
  const adminLayout = read("dashboard/src/app/admin/(console)/layout.tsx");
  const deskLayout = read("dashboard/src/app/(desk)/layout.tsx");
  const links = read("dashboard/src/lib/adminLinks.ts");

  it("keeps admin nav off the owner link list and the layouts apart", () => {
    assert.match(links, /export const ADMIN_LINKS/);
    assert.match(deskNav, /export const DESK_LINKS/);
    assert.doesNotMatch(adminNav, /DESK_LINKS/);
    assert.doesNotMatch(links, /DESK_LINKS/);
    assert.doesNotMatch(deskNav, /ADMIN_LINKS/);
    assert.doesNotMatch(adminLayout, /DESK_LINKS/);
    assert.doesNotMatch(adminLayout, /DeskRail/);
    assert.doesNotMatch(adminLayout, /DeskTabBar/);
    assert.doesNotMatch(adminLayout, /from "@\/components\/DeskNav"/);
    assert.doesNotMatch(deskLayout, /ADMIN_LINKS/);
    assert.doesNotMatch(deskLayout, /AdminNav/);
    assert.doesNotMatch(deskLayout, /AdminRail/);
    assert.match(adminLayout, /isLegacyAuthenticated/);
    assert.match(adminLayout, /redirect\(\(await getAuthUser\(\)\) \? "\/home" : "\/admin\/login"\)/);
    assert.match(deskLayout, /redirect\("\/admin"\)/);
    assert.match(deskLayout, /redirect\("\/login"\)/);
    assert.doesNotMatch(adminLayout, /bg-brand-900/);
    assert.match(adminNav, /data-admin-rail/);
    assert.match(adminNav, /data-admin-tabbar/);
    assert.match(adminNav, /md:flex/);
    assert.match(adminNav, /md:hidden/);
    assert.match(adminNav, /min-h-12/);
    assert.match(adminNav, /adminPhoneTabs\(\)/);
    assert.match(adminNav, />More</);
    assert.doesNotMatch(adminNav, /overflow-x-auto/);
    assert.doesNotMatch(adminNav, /w-\[4\.5rem\]/);
    assert.deepEqual(loadParents().phoneTabs, ["Overview", "Businesses", "Quality", "Numbers"]);
    assert.deepEqual(loadParents().phoneMore, ["Platform", "Packages", "Voices"]);
    assert.match(links, /safe-area-inset-top/);
    assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/app/(desk)/loading.tsx")), false);
    assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/app/admin/loading.tsx")), false);
    assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/app/admin/(console)/loading.tsx")), true);
  });

  it("names a nested screen for the parent admin list", () => {
    const got = loadParents();
    assert.equal(got.overview, null);
    assert.deepEqual(got.billingClient, { href: "/admin", label: "Overview" });
    assert.deepEqual(got.wallets, { href: "/admin", label: "Overview" });
    assert.deepEqual(got.ledgerNested, { href: "/admin", label: "Overview" });
    assert.equal(got.businesses, null);
    assert.deepEqual(got.nested, { href: "/admin/businesses", label: "Businesses" });
    assert.deepEqual(got.unknown, { href: "/admin", label: "Overview" });
    assert.deepEqual(got.query, { href: "/admin/voices", label: "Voices" });
    assert.ok(got.labels.includes("Packages"));
    assert.ok(got.labels.includes("Platform"));
    assert.ok(!got.labels.includes("Ledger"));
    assert.ok(!got.labels.includes("Billing"));
    for (const label of got.labels) {
      assert.notEqual(label, "Back");
    }
    assert.equal(got.nested.label === "Back", false);
    assert.doesNotMatch(adminNav, />Back</);
    assert.match(adminNav, /adminParentTarget/);
    assert.match(adminNav, /<DeskBack href=\{href\(parent\.href\)\}>\{parent\.label\}<\/DeskBack>/);
    assert.doesNotMatch(adminNav, /BackChevron/);
  });

  it("gives Super Admin the same account header as the desk, with This device", () => {
    const menu = read("dashboard/src/components/AdminAccountMenu.tsx");
    const account = read("dashboard/src/components/DeskAccountMenu.tsx");
    assert.match(adminNav, /<AdminAccountMenu/);
    assert.match(adminNav, /operatorName/);
    assert.doesNotMatch(adminNav, /action="\/api\/logout"/);
    assert.match(menu, /data-account-bar=""/);
    assert.match(menu, /href="\/admin"/);
    assert.match(menu, /<ThemePicker \/>/);
    assert.match(menu, />\s*This device\s*</);
    assert.match(menu, />\s*Appearance\s*</);
    assert.match(menu, /SignOutButton/);
    assert.doesNotMatch(menu, /DeskAccountMenu|switchDeskTenant|\/home/);
    assert.match(account, /data-account-bar=""/);
    const adminDoc = read("docs/frontend/design-system/pages/admin.md");
    assert.match(adminDoc, /account header/);
    assert.match(adminDoc, /This device/);
  });
});

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
    import { adminParentTarget, ADMIN_LINKS } from ${JSON.stringify(linksPath)};
    const cases = {
      overview: adminParentTarget("/admin"),
      billingClient: adminParentTarget("/admin/billing/abc"),
      wallets: adminParentTarget("/admin/wallets"),
      ledgerNested: adminParentTarget("/admin/wallets/abc"),
      nested: adminParentTarget("/admin/businesses/abc"),
      unknown: adminParentTarget("/admin/ops/extra"),
      query: adminParentTarget("/admin/voices/1?x=1"),
      labels: ADMIN_LINKS.map((item) => item.label),
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
    assert.match(links, /safe-area-inset-top/);
    assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/app/(desk)/loading.tsx")), false);
    assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/app/admin/loading.tsx")), false);
    assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/app/admin/(console)/loading.tsx")), false);
  });

  it("names a nested screen for the parent admin list", () => {
    const got = loadParents();
    assert.equal(got.overview, null);
    assert.deepEqual(got.billingClient, { href: "/admin", label: "Overview" });
    assert.equal(got.wallets, null);
    assert.deepEqual(got.ledgerNested, { href: "/admin/wallets", label: "Ledger" });
    assert.deepEqual(got.nested, { href: "/admin/businesses", label: "Businesses" });
    assert.deepEqual(got.unknown, { href: "/admin", label: "Overview" });
    assert.deepEqual(got.query, { href: "/admin/voices", label: "Voices" });
    assert.ok(got.labels.includes("Packages"));
    assert.ok(got.labels.includes("Ledger"));
    assert.ok(!got.labels.includes("Billing"));
    for (const label of got.labels) {
      assert.notEqual(label, "Back");
    }
    assert.equal(got.nested.label === "Back", false);
    assert.doesNotMatch(adminNav, />Back</);
    assert.match(adminNav, /adminParentTarget/);
  });
});

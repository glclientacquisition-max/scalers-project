"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const model = require("../dashboard/src/lib/adminActivityModel.ts");
const links = require("../dashboard/src/lib/adminLinks.ts");

/** Lib helpers that write their own audit row (in TS or inside the SQL function they call). */
const SELF_AUDITING = {
  releaseBusinessNumber: "dashboard/src/lib/adminBusinessActions.ts",
  releasePoolNumber: "dashboard/src/lib/adminBusinessActions.ts",
  archiveBusiness: "dashboard/src/lib/adminBusinessActions.ts",
  restoreBusiness: "dashboard/src/lib/adminBusinessActions.ts",
  deleteArchivedBusiness: "dashboard/src/lib/adminBusinessActions.ts",
  // These call billing RPCs that insert into ops_audit_log themselves.
  grantTenantPackageMinutes: "rpc:grant_tenant_package_minutes",
  setTenantBillingMode: "rpc:set_tenant_billing_mode",
};

function fnBody(src, name) {
  const start = src.search(new RegExp(`export async function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function writeRoutes() {
  const dir = path.join(ROOT, "dashboard/src/app/api/admin");
  const files = fs
    .readdirSync(dir)
    .map((d) => `dashboard/src/app/api/admin/${d}/route.ts`)
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)));
  files.push("dashboard/src/app/api/did-pool/route.ts");
  return files
    .map((rel) => ({ rel, src: read(rel) }))
    .filter(({ src }) => /export async function (POST|PATCH|PUT|DELETE)\b/.test(src));
}

describe("Activity: every admin write is recorded", () => {
  it("each POST action branch records itself or calls a helper that does", () => {
    const missing = [];
    let branches = 0;
    for (const { rel, src } of writeRoutes()) {
      if (rel.endsWith("/session/route.ts")) continue; // sign in and out, not an admin change
      const post = src.slice(src.indexOf("export async function POST"));
      const parts = post.split(/(?=if \(action === ")/);
      const scoped = parts.length > 1 ? parts.slice(1) : [post];
      for (const part of scoped) {
        branches += 1;
        const name = (part.match(/action === "([^"]+)"/) || [null, "(single)"])[1];
        if (/recordAdminAction\(/.test(part)) continue;
        const helper = Object.keys(SELF_AUDITING).find((fn) => new RegExp(`await ${fn}\\(`).test(part));
        if (!helper) missing.push(`${rel} ${name}`);
      }
    }
    assert.ok(branches >= 20, `only ${branches} write branches found`);
    assert.deepEqual(missing, []);
  });

  it("the self-auditing helpers really record", () => {
    for (const [fn, where] of Object.entries(SELF_AUDITING)) {
      if (where.startsWith("rpc:")) {
        const lib = read(fn === "setTenantBillingMode" ? "dashboard/src/lib/adminWallets.ts" : "dashboard/src/lib/adminBilling.ts");
        assert.match(fnBody(lib, fn), new RegExp(where.slice(4)), fn);
        continue;
      }
      assert.match(fnBody(read(where), fn), /recordAdminAction\(/, fn);
    }
  });

  it("records who from the session, never the request body", () => {
    for (const { rel, src } of writeRoutes()) {
      if (!/recordAdminAction\(/.test(src)) continue;
      assert.match(src, /adminActorName\(\)/, rel);
      assert.doesNotMatch(src, /actor:\s*body\./, rel);
    }
  });

  it("number assign and release, archive, and package changes carry before and after", () => {
    const actions = read("dashboard/src/lib/adminBusinessActions.ts");
    for (const action of ["release_number", "archive_business", "restore_business", "delete_business"]) {
      const at = actions.indexOf(`action: "${action}"`);
      assert.ok(at >= 0, action);
      assert.match(actions.slice(at, at + 400), /before:/, action);
    }
    const packages = read("dashboard/src/app/api/admin/packages/route.ts");
    for (const action of ["save_rates", "save_package", "assign_package"]) assert.match(packages, new RegExp(`"${action}"`));
    assert.match(read("dashboard/src/app/api/did-pool/route.ts"), /action: "assign_number"[\s\S]{0,300}after:/);
  });

  it("the delete row is written before the business is gone", () => {
    const body = fnBody(read("dashboard/src/lib/adminBusinessActions.ts"), "deleteArchivedBusiness");
    assert.ok(body.indexOf("recordAdminAction(") < body.indexOf("remove_business_and_release_did"));
  });
});

describe("Activity: model", () => {
  it("labels actions in plain words", () => {
    assert.equal(model.actionLabel("archive_business"), "Archived business");
    assert.equal(model.actionLabel("assign_number"), "Assigned number");
    assert.equal(model.actionLabel("something_new"), "Something new");
    for (const action of model.ACTIVITY_ACTIONS) assert.doesNotMatch(model.actionLabel(action), /_/);
  });

  it("stamps in East Africa time", () => {
    assert.equal(model.eatStamp("2026-10-09T10:05:00Z"), "9 Oct 13:05");
    assert.equal(model.eatStamp("2026-10-09T22:30:00Z"), "10 Oct 01:30");
    assert.equal(model.eatStamp("nope"), "");
  });

  it("lists only what changed, before and after", () => {
    const lines = model.changeLines({ number: "+254700000001", package: "Starter" }, { number: null, package: "Starter" });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].before, "+254700000001");
  });

  it("keeps a deleted business's name", () => {
    const item = model.activityItem(
      {
        id: "a",
        created_at: "2026-10-09T10:05:00Z",
        actor: "alvin",
        action: "delete_business",
        tenant_id: null,
        amount_kes: null,
        detail: { business_name: "Jirani", before: { business_name: "Jirani" }, after: null },
      },
      new Map(),
    );
    assert.equal(item.business, "Jirani");
    assert.equal(item.actor, "alvin");
    assert.equal(item.when, "9 Oct 13:05");
  });

  it("accepts only a business id and a short operator name as filters", () => {
    const id = "6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
    assert.deepEqual(model.parseActivityFilters({ business: id, actor: "alvin" }), { business: id, actor: "alvin" });
    assert.equal(model.parseActivityFilters({ business: "'; drop", actor: "x".repeat(65) }).business, null);
    assert.equal(model.parseActivityFilters({ actor: "x".repeat(65) }).actor, null);
    assert.equal(model.activityHref({ business: null, actor: null }), "/admin/activity");
    assert.match(model.activityHref({ business: id, actor: "a b" }), /business=6f1c[\s\S]*actor=a(\+|%20)b/);
  });
});

describe("Activity: screen", () => {
  const page = read("dashboard/src/app/admin/(console)/activity/page.tsx");
  const panel = read("dashboard/src/components/AdminActivityPanel.tsx");
  const loader = read("dashboard/src/lib/adminActivity.ts");

  it("guards first, page and loader", () => {
    const firstAwait = (src) => (src.match(/await [A-Za-z.]+\(/) || [""])[0];
    assert.equal(firstAwait(page.slice(page.indexOf("export default async function"))), "await requireSuperAdmin(");
    assert.equal(firstAwait(fnBody(loader, "loadAdminActivity")), "await requireSuperAdmin(");
  });

  it("is live in the nav (More on phone) and linked from the business sheet", () => {
    const item = links.ADMIN_LINKS.find((l) => l.label === "Activity");
    assert.equal(item.href, "/admin/activity");
    assert.equal(item.pending, undefined);
    assert.ok(links.ADMIN_MORE_LINKS.some((l) => l.href === "/admin/activity"));
    assert.match(read("dashboard/src/components/AdminBusinessesPanel.tsx"), /\/admin\/activity\?business=\$\{open\.id\}/);
  });

  it("filters in Sheets and opens detail in a Sheet; no centred dialog", () => {
    assert.match(panel, /<ChoiceSheet[\s\S]*rowLabel="Business"/);
    assert.match(panel, /<ChoiceSheet[\s\S]*rowLabel="Operator"/);
    assert.match(panel, /<Sheet\b/);
    assert.doesNotMatch(panel, /Dialog|AlertDialog|role="dialog"|framer-motion|motion\//);
    assert.doesNotMatch(panel + page, /ops_audit_log|Supabase|Vercel|Resend|SautiKit|Soniox/i);
  });
});

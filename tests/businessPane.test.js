const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const load = (rel) => import(path.join(root, rel));

describe("shared BusinessPane (t179u)", () => {
  let bp, att, search;
  before(async () => {
    bp = await load("dashboard/src/lib/ops/businessPane.ts");
    att = await load("dashboard/src/lib/ops/attentionView.ts");
    search = await load("dashboard/src/lib/ops/searchView.ts");
  });

  it("keeps the fixed section order", () => {
    assert.deepEqual(bp.BUSINESS_PANE_SECTIONS.map((s) => s.id), ["summary", "usage", "money", "number", "calls", "history"]);
  });

  it("builds one URL, opening on the entry's section", () => {
    assert.equal(bp.businessPaneHref("b1"), "/admin/businesses?pane=b1");
    assert.equal(bp.businessPaneHref("b1", "money"), "/admin/businesses?pane=b1&section=money");
    assert.equal(bp.sectionForEntry("billing"), "money");
    assert.equal(bp.sectionForEntry("quality"), "calls");
    assert.equal(bp.parsePaneSection("nope"), "summary");
  });

  it("redirects the old business and billing tenant pages", () => {
    assert.equal(bp.businessPaneRedirect("/admin/businesses/b1"), "/admin/businesses?pane=b1");
    assert.equal(bp.businessPaneRedirect("/admin/billing/b1"), "/admin/businesses?pane=b1&section=money");
    for (const p of ["app/admin/(console)/businesses/[id]/page.tsx", "app/admin/(console)/billing/[tenantId]/page.tsx"]) {
      assert.match(read(`dashboard/src/${p}`), /isAdminV2Enabled\(\)\) redirect\(businessPaneHref/);
    }
  });

  it("⌘K and attention use the same pane URL", () => {
    const hit = search.businessHit({ id: "b1", business_name: "A", archived: false });
    assert.equal(hit.href, bp.businessPaneHref("b1"));
    assert.equal(search.numberHit({ id: "n", e164: "+254700000000", tenant_id: "b1" }).href, bp.businessPaneHref("b1", "number"));
    assert.ok(att);
  });

  it("every v2 entry point links to the pane, not the old pages", () => {
    for (const f of ["AdminInvoicesV2", "AdminAttentionV2", "AdminInsightsV2", "AdminUsageV2"]) {
      const s = read(`dashboard/src/components/admin/v2/${f}.tsx`);
      assert.match(s, /businessPaneHref\(/, f);
      assert.doesNotMatch(s, /href: `\/admin\/(businesses|billing|quality)\/\$\{[^}]+\}`/, f);
    }
  });

  it("pane route is GET only and authed; pane makes no writes", () => {
    const route = read("dashboard/src/app/api/admin/businesses/[id]/pane/route.ts");
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
    assert.match(route, /isLegacyAuthenticated/);
    const ui = read("dashboard/src/components/admin/v2/BusinessPane.tsx");
    assert.doesNotMatch(ui, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
    assert.match(ui, /data-pane-section/);
    assert.doesNotMatch(ui.replace(/sautikit_virtual_number/g, ""), /sautikit|bachs|elevenlabs|twilio|wallet|prepaid|top.?up/i);
    // Unlock/Hold (if present) stay non-writing; package/minutes/charging stay read-only.
    assert.doesNotMatch(ui, /fetch\([^)]*method:\s*"POST"/);
    assert.match(ui, /step-up|StepUpSheet|data-stepup="business"/);
  });
});

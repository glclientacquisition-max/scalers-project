"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const model = require("../dashboard/src/lib/adminGlobalSearchModel.ts");

describe("Super Admin global search", () => {
  const search = read("dashboard/src/lib/adminGlobalSearch.ts");
  const route = read("dashboard/src/app/api/admin/search/route.ts");
  const chrome = read("dashboard/src/components/AdminAccountMenu.tsx");

  it("normalizes queries and builds business and call hits", () => {
    assert.equal(model.normalizeSearchQuery("  hd_abc  "), "hd_abc");
    assert.equal(model.searchQueryReady("a"), false);
    assert.equal(model.searchQueryReady("ab"), true);
    const biz = model.businessSearchHit({
      id: "t1",
      business_name: "Jirani",
      sautikit_virtual_number: "+254700111222",
    });
    assert.equal(biz.href, "/admin/businesses/t1");
    const call = model.callSearchHit({ id: "HD_abc", business_name: "Jirani" });
    assert.match(call.href, /\/admin\/quality\/call\//);
    const merged = model.mergeSearchHits([biz], [call], 3);
    assert.equal(merged.length, 2);
  });

  it("searches tenants and calls on the server and exposes a gated API route", () => {
    assert.match(search, /adminGlobalSearch/);
    assert.match(search, /from\("tenants"\)/);
    assert.match(search, /from\("calls"\)/);
    assert.match(route, /isLegacyAuthenticated/);
    assert.match(route, /adminGlobalSearch/);
  });

  it("shows search in the admin header from md breakpoint", () => {
    assert.match(chrome, /AdminGlobalSearch/);
    assert.match(chrome, /md:block/);
  });
});

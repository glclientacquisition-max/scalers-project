"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("Super Admin shop people and profile", () => {
  const profile = read("dashboard/src/lib/adminBusinessProfile.ts");
  const route = read("dashboard/src/app/api/admin/businesses/route.ts");
  const shop = read("dashboard/src/app/admin/(console)/businesses/[id]/page.tsx");
  const panel = read("dashboard/src/components/admin/AdminShopPeople.tsx");

  it("updates profile, sends owner reset, and transfers ownership with audit", () => {
    assert.match(profile, /updateBusinessProfile/);
    assert.match(profile, /sendOwnerPasswordReset/);
    assert.match(profile, /adminTransferOwnership/);
    assert.match(profile, /recordAdminAction/);
    assert.match(profile, /resetPasswordForEmail/);
  });

  it("wires shop actions through the businesses API", () => {
    assert.match(route, /update_profile/);
    assert.match(route, /send_owner_reset/);
    assert.match(route, /transfer_owner/);
  });

  it("loads people on the shop page and lists members in the UI", () => {
    assert.match(shop, /loadAdminShopPeople/);
    assert.match(shop, /AdminShopPeople/);
    assert.match(panel, /Transfer ownership/);
    assert.match(panel, /Send owner password reset/);
  });
});

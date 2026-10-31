const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * Desk UX slice of bookings+holds honesty P0.
 * K4: gate hospitality Confirm booking until reservations exist.
 * A1: requested visit is Confirm language; open holds are "to fulfil" (owner review, Oct 2026).
 * Keep in lockstep with dashboard/src/lib/inboxNiche.ts and whose-turn.
 */
function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function sliceHospitalityNiche(src) {
  const start = src.indexOf("hospitality: {");
  const home = src.indexOf("home_services: {");
  const general = src.indexOf("general: {");
  assert.ok(start >= 0 && general > start, "hospitality niche block");
  const end = general;
  const block = src.slice(start, end);
  assert.ok(!block.includes("home_services"), "hospitality slice stayed in hospitality");
  assert.ok(home >= 0 && home < start, "home_services precedes hospitality");
  return block;
}

function sliceHomeServicesNiche(src) {
  const start = src.indexOf("home_services: {");
  const hospitality = src.indexOf("hospitality: {");
  assert.ok(start >= 0 && hospitality > start, "home_services niche block");
  return src.slice(start, hospitality);
}

describe("bookings + holds honesty desk copy", () => {
  const niche = read("dashboard/src/lib/inboxNiche.ts");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const holdActions = read("dashboard/src/components/RequestStatusToggle.tsx");
  const jobActions = read("dashboard/src/components/InboxJobActions.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");

  it("gates hospitality Confirm booking until reservations exist (K4)", () => {
    assert.match(niche, /export const HOSPITALITY_RESERVATIONS_EXIST = false/);
    assert.match(niche, /resolvedType\(input\)/);
    assert.match(niche, /return NICHE.general/);
    const hospitality = sliceHospitalityNiche(niche);
    assert.match(hospitality, /jobCtaOne: "Confirm visit"/);
    assert.doesNotMatch(hospitality, /Confirm booking/);
    const homeServices = sliceHomeServicesNiche(niche);
    assert.match(homeServices, /jobCtaOne: "Confirm visit"/);
    assert.match(homeServices, /confirmStamp: "Confirm visit"/);
    assert.doesNotMatch(homeServices, /Confirm booking/);
  });

  it("keeps requested-visit whose-turn on Confirm, not booked (A1)", () => {
    assert.match(verbs, /recipe === "confirm"[\s\S]*confirmStamp/);
    assert.match(verbs, /recipe === "hold_done"[\s\S]*"Hold Done"/);
    assert.doesNotMatch(verbs, /booked/);
    const hospitality = sliceHospitalityNiche(niche);
    assert.match(hospitality, /confirmStamp: "Confirm visit"/);
    assert.doesNotMatch(hospitality, /booked a visit|you're booked|Confirm booking/);
  });

  it("uses Fulfil hold on Home CTAs and Hold Done on the ticket banner (A1)", () => {
    assert.match(niche, /holdCtaOne: "Fulfil hold"/);
    assert.match(niche, /holdCtaMany: "Fulfil holds"/);
    assert.doesNotMatch(niche, /Fulfill hold/);
    assert.match(home, /copy\.holdCtaOne/);
    assert.match(home, /copy\.holdCtaMany/);
    // Hold Done only for a real hold; a callback or enquiry banner says Mark done (holdDoneLabel).
    assert.match(holdActions, /wide \? holdDoneLabel\(\{ request_type: requestType \}, vertical\) : "Done"/);
    assert.match(jobActions, /"Confirm"/);
    assert.doesNotMatch(jobActions, /Confirm booking/);
  });

  it("uses to fulfil on Home hold units (never the ambiguous Hold Done)", () => {
    const holdUnits = [...niche.matchAll(/holdUnit: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(holdUnits.length >= 4, "every niche sets holdUnit");
    for (const unit of holdUnits) {
      assert.equal(unit, "to fulfil");
    }
    assert.doesNotMatch(niche, /holdUnit: "to fulfill"/);
    assert.doesNotMatch(home, /to fulfill/);
    assert.doesNotMatch(home, /\bfulfill\b/);
    assert.match(home, /copy\.holdUnit/);
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    const briefing = purpose.slice(
      purpose.indexOf("export function homeBriefing"),
      purpose.indexOf("export function homeDigestLine")
    );
    assert.match(briefing, /copy\.holdUnit/);
    assert.doesNotMatch(briefing, /to fulfill/);
    assert.doesNotMatch(briefing, /\bfulfill\b/);
    const queues = home.slice(home.indexOf("const queues"), home.indexOf("let ctaHref"));
    assert.match(queues, /homeQueueUnit\(work\.toFulfill, copy\.holdUnit/);
    assert.doesNotMatch(queues, /to fulfill/);
  });
});

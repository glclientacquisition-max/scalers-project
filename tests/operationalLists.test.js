const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("operational lists (Phase 4)", () => {
  const requests = read("dashboard/src/app/(desk)/requests/page.tsx");
  const appointments = read("dashboard/src/app/(desk)/appointments/page.tsx");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const settings = read("dashboard/src/app/(desk)/settings/page.tsx");
  const settingsNav = read("dashboard/src/lib/businessSettingsNav.ts");

  it("does not use dead settings hash routes in desk UI", () => {
    assert.doesNotMatch(calls, /\/settings#train|\/settings#test/);
    assert.doesNotMatch(appointments, /\/settings#train|\/settings#test/);
    assert.doesNotMatch(requests, /\/settings#train|\/settings#test/);
    assert.match(calls, /businessSettingsHref\("train"\)/);
    assert.match(calls, /businessSettingsHref\("test"\)/);
  });

  it("resolves Settings tabs from query params", () => {
    assert.match(settings, /parseBusinessSettingsTab/);
    assert.match(settingsNav, /raw === "test"/);
    assert.match(settingsNav, /q\.set\("tab", tab\)/);
  });

  it("Requests uses tenant-wide head counts, not page-filtered Open", () => {
    assert.match(requests, /count: "exact", head: true/);
    assert.doesNotMatch(requests, /rows\.filter\(\(r\) => r\.status === "open"\)/);
    assert.match(requests, /No requests/);
    assert.doesNotMatch(requests, /text-\[var\(--ink\)\]/);
  });

  it("Appointments is a dense list with real related-call links", () => {
    assert.match(appointments, /href=\{`\/calls\/\$\{callId\}`\}/);
    assert.doesNotMatch(appointments, /Related calls/);
    assert.doesNotMatch(
      appointments,
      /Visit requests your receptionist booked/
    );
    assert.doesNotMatch(appointments, /text-\[var\(--ink\)\]/);
    assert.doesNotMatch(appointments, /px-4 py-10/);
    assert.match(appointments, /No appointments/);
  });
});

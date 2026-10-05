const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  settingsLeaveHref,
  settingsLeaveTarget,
} = require("../dashboard/src/lib/settingsLeave.js");
const {
  markSavedRow,
  isSavedRow,
  carrySavedRow,
} = require("../dashboard/src/lib/savedRow.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const here = "http://localhost:3020/dev/settings-jobs?tab=train&panel=identity";

describe("settings leave target", () => {
  it("keeps same-page, hash, and outside clicks", () => {
    assert.equal(
      settingsLeaveHref("/settings?tab=train&panel=hours", here),
      "/settings?tab=train&panel=hours"
    );
    assert.equal(settingsLeaveHref("?tab=train&panel=identity", here), null);
    assert.equal(settingsLeaveHref("#voice", here), null);
    assert.equal(settingsLeaveHref(`${here}#voice`, here), null);
    assert.equal(settingsLeaveHref("https://example.com/settings", here), null);
    assert.equal(settingsLeaveHref("", here), null);
  });

  it("asks only when the form is dirty and the click is unmodified", () => {
    assert.equal(
      settingsLeaveTarget({ dirty: false, href: "/settings", modified: false }),
      null
    );
    assert.equal(
      settingsLeaveTarget({ dirty: true, href: "/settings", modified: true }),
      null
    );
    assert.equal(settingsLeaveTarget({ dirty: true, href: null, modified: false }), null);
    assert.equal(
      settingsLeaveTarget({ dirty: true, href: "/settings?tab=train&panel=hours", modified: false }),
      "/settings?tab=train&panel=hours"
    );
  });
});

describe("saved settings rows", () => {
  it("hides the saved mark from JSON and from a plain spread", () => {
    const row = markSavedRow({ name: "Amina" });
    assert.equal(isSavedRow(row), true);
    assert.equal(JSON.stringify(row), '{"name":"Amina"}');
    assert.equal(isSavedRow({ ...row, name: "Amina" }), false);
    assert.equal(isSavedRow(carrySavedRow({ ...row, name: "Amina" }, row)), true);
    assert.equal(isSavedRow(carrySavedRow({ name: "New" }, { name: "New" })), false);
  });
});

describe("settings discard and remove sheets", () => {
  it("guards settings navigation and confirms a saved teammate", () => {
    const shell = read("dashboard/src/components/BusinessSettingsShell.tsx");
    const form = read("dashboard/src/components/TenantForm.tsx");
    const coach = read("dashboard/src/components/PronunciationCoach.tsx");
    const alerts = read("dashboard/src/components/AlertsPanel.tsx");
    const confirm = read("dashboard/src/components/ui/ConfirmSheet.tsx");
    assert.equal((shell.match(/<SettingsLeaveGuard>/g) || []).length, 2);
    assert.match(form, /useSettingsLeaveSource\("form", formDirty\)/);
    assert.match(form, /They leave the team when you save\./);
    assert.match(form, /requestRemove\(\s*member/);
    assert.match(alerts, /useSettingsLeaveSource\("alerts", alertsDirty\)/);
    assert.match(coach, /useSettingsLeaveSource\("pronunciation", unsavedReview\)/);
    assert.match(coach, /The phone stops using it\./);
    assert.match(coach, /setRemoveTarget/);
    assert.doesNotMatch(coach, /onClick=\{\(\) => removeEntry/);
    assert.match(confirm, /cancelLabel = "Cancel"/);
    assert.match(read("dashboard/src/components/SettingsLeaveGuard.tsx"), /Keep editing/);
    assert.match(read("dashboard/src/components/SettingsLeaveGuard.tsx"), /Discard changes\?/);
    assert.doesNotMatch(read("dashboard/src/components/SettingsLeaveGuard.tsx"), /[—–]/);
    assert.doesNotMatch(form.slice(form.indexOf("function requestRemove")), /[—–]/);
  });
});

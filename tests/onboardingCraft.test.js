const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("onboarding craft", () => {
  const page = read("dashboard/src/app/onboarding/page.tsx");
  const wizard = read("dashboard/src/app/onboarding/OnboardingWizard.tsx");

  it("drops e.g. placeholders and unused tone blurbs", () => {
    assert.doesNotMatch(wizard, /e\.g\./);
    assert.doesNotMatch(wizard, /blurb:/);
    assert.doesNotMatch(wizard, /TONE_OPTIONS/);
    assert.match(wizard, /TONE_LABELS/);
  });

  it("keeps step chrome decorative and the card on desk surfaces", () => {
    const steps = wizard.slice(wizard.indexOf("aria-label=\"Setup progress\""), wizard.indexOf("<form"));
    assert.match(steps, /<span/);
    assert.doesNotMatch(steps, /<button/);
    assert.match(wizard, /rounded-2xl border border-line/);
    assert.doesNotMatch(wizard, /shadow-\[0_20px/);
  });

  it("offers a muted Sign out exit in the header", () => {
    assert.match(page, /\/api\/logout/);
    assert.match(page, />\s*Sign out\s*</);
    assert.match(page, /text-ink-soft/);
  });
});

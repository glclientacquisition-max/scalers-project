const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("design system convergence (Phase 5)", () => {
  const login = read("dashboard/src/app/login/page.tsx");
  const signup = read("dashboard/src/app/signup/page.tsx");
  const signupForm = read("dashboard/src/app/signup/SignupForm.tsx");
  const signupActions = read("dashboard/src/app/signup/actions.ts");
  const onboarding = read("dashboard/src/app/onboarding/OnboardingWizard.tsx");
  const callDetail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const callsPage = read("dashboard/src/app/(desk)/calls/page.tsx");
  const settingsPage = read("dashboard/src/app/(desk)/settings/page.tsx");
  const notify = read("dashboard/src/lib/notifyChannels.ts");
  const landing = read("dashboard/src/components/marketing/LandingPage.tsx");

  it("auth and onboarding use canonical tokens and field rings", () => {
    for (const src of [login, signup, signupForm, onboarding]) {
      assert.doesNotMatch(src, /text-\[var\(--ink\)\]/);
      assert.doesNotMatch(src, /border-\[var\(--line\)\]/);
    }
    for (const src of [login, signupForm, onboarding]) {
      assert.match(src, /focus:ring-\[#0096FF\]\/40/);
    }
    assert.match(signup, /focus-visible:ring-\[#0096FF\]\/40/);
    assert.match(login, /bg-\[#0096FF\]/);
    assert.match(signupForm, /bg-\[#0096FF\]/);
    assert.match(onboarding, /bg-\[#0096FF\]/);
  });

  it("does not show opening-line fluff or SQL paths to owners", () => {
    assert.doesNotMatch(onboarding, /Opening your line/);
    assert.match(onboarding, /\{pending \? "Saving" : "Finish setup"\}/);
    assert.doesNotMatch(signupActions, /docs\/supabase/);
    assert.doesNotMatch(signupActions, /Supabase Auth is not configured/);
    assert.doesNotMatch(callsPage, /docs\/supabase/);
    assert.doesNotMatch(settingsPage, /docs\/supabase/);
    assert.match(callsPage, /Calls could not be loaded/);
  });

  it("call detail primary CTA is blue fill with a WhatsApp glyph", () => {
    assert.match(callDetail, /Reply on WhatsApp/);
    assert.match(callDetail, /bg-\[#0096FF\]/);
    assert.doesNotMatch(callDetail, /bg-\[#25D366\]/);
    assert.match(callDetail, />\s*Back\s*</);
  });

  it("notify copy has no Coming soon or em dash", () => {
    assert.doesNotMatch(notify, /Coming soon/);
    assert.match(notify, /unavailableLabel: "WhatsApp alerts are not available"/);
    assert.doesNotMatch(notify, /unavailableLabel: "Coming soon/);
  });

  it("does not Desk-normalize the landing page", () => {
    assert.match(landing, /landing-rise|text-5xl|text-6xl/);
  });
});

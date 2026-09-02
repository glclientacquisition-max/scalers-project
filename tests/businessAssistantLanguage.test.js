const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("business assistant language (Phase 7)", () => {
  const commandCenter = read("dashboard/src/app/(desk)/home/commandCenter.ts");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");
  const settingsShell = read("dashboard/src/components/BusinessSettingsShell.tsx");
  const testPanel = read("dashboard/src/components/TestLinePanel.tsx");
  const tenantForm = read("dashboard/src/components/TenantForm.tsx");
  const ingest = read("dashboard/src/components/KnowledgeIngestPanel.tsx");
  const callDetail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const onboarding = read("dashboard/src/app/onboarding/OnboardingWizard.tsx");
  const onboardingActions = read("dashboard/src/app/onboarding/actions.ts");
  const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
  const layout = read("dashboard/src/app/layout.tsx");
  const handoff = read("dashboard/src/lib/handoffMode.ts");
  const faqs = read("dashboard/src/components/CallFaqSuggestions.tsx");

  it("uses assistant CTAs and readiness words on Home", () => {
    assert.match(commandCenter, /Test assistant/);
    assert.match(commandCenter, /Teach assistant/);
    assert.doesNotMatch(commandCenter, /Test receptionist|Train receptionist/);
    assert.match(commandCenter, /Finish setup/);
    assert.match(commandCenter, /Assistant name/);
    assert.doesNotMatch(commandCenter, /return "Prompt"/);
    assert.doesNotMatch(commandCenter, /return "Agent"/);
    assert.match(home, /Your assistant can take calls/);
    assert.match(home, /Line live/);
    assert.match(home, /Needs training/);
    assert.doesNotMatch(home, /\bOnline\b/);
  });

  it("retitles Train identity without adding a global Assistant tab", () => {
    assert.match(settingsShell, /label: "Assistant"/);
    assert.doesNotMatch(settingsShell, /Agent Persona/);
    assert.match(settingsShell, /label: "Team"/);
    assert.doesNotMatch(settingsShell, /Escalation Team/);
    assert.match(settingsShell, /Train/);
    const deskNav = read("dashboard/src/components/DeskNav.tsx");
    assert.doesNotMatch(deskNav, /Assistant|Receptionist/);
  });

  it("keeps owner chrome free of prompt, AI, and receptionist product language", () => {
    assert.match(tenantForm, /Assistant name/);
    assert.match(tenantForm, /When a human is needed/);
    assert.match(tenantForm, /Your assistant will use this on the next call/);
    assert.doesNotMatch(tenantForm, /basic mode/);
    assert.doesNotMatch(tenantForm, /Your receptionist will use/);
    assert.match(testPanel, />\s*Assistant\s*</);
    assert.match(ingest, /Add business information/);
    assert.match(ingest, /Add to my assistant/);
    assert.match(callDetail, /"Assistant"/);
    assert.doesNotMatch(callDetail, /"Receptionist"/);
    assert.match(calls, /Teach assistant/);
    assert.match(onboarding, /Assistant name & tone/);
    assert.match(onboardingActions, /Could not finish assistant setup/);
    assert.doesNotMatch(onboardingActions, /receptionist prompt/);
    assert.match(landing, /The business assistant for Kenyan SMEs/);
    assert.doesNotMatch(landing, /autonomous/i);
    assert.doesNotMatch(layout, /Autonomous business assistant/);
    assert.match(handoff, /The assistant stays on the line/);
    assert.doesNotMatch(handoff, /AI stays on the line/);
    assert.match(faqs, /What the assistant should say/);
  });
});

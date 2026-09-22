const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('agent tone offer', () => {
  const onboarding = read('dashboard/src/lib/onboarding.ts');
  const compiler = read('dashboard/src/lib/promptCompiler.ts');
  const form = read('dashboard/src/components/TenantForm.tsx');
  const wizard = read('dashboard/src/app/onboarding/OnboardingWizard.tsx');

  it('offers only Professional and Warm manner', () => {
    assert.match(onboarding, /export type OnboardingTone = "professional" \| "warm"/);
    assert.match(onboarding, /id: "professional", blurb: "Calm and short\."/);
    assert.match(
      onboarding,
      /id: "warm", blurb: "Helpful, like a good receptionist\."/
    );
    assert.doesNotMatch(form, /Localized \/ Sheng|id: "localized"|id: "empathetic"|id: "friendly"/);
    assert.doesNotMatch(wizard, /Localized \/ Sheng|TONE_IDS/);
    assert.match(wizard, /TONE_OPTIONS/);
    assert.match(form, /TONE_OPTIONS/);
  });

  it('maps older chips onto Warm and keeps Professional', () => {
    assert.match(onboarding, /friendly: "warm"/);
    assert.match(onboarding, /empathetic: "warm"/);
    assert.match(onboarding, /localized: "warm"/);
    assert.match(compiler, /return canonicalizeAgentTone\(raw\)/);
  });

  it('compiles distinct manner lines and keeps mood plus language for every tone', () => {
    assert.match(
      onboarding,
      /Tone: professional\. Calm and short\. No extra warmth/
    );
    assert.match(onboarding, /Tone: warm\. Helpful Kenyan receptionist/);
    assert.match(onboarding, /This mood rule applies for every tone/);
    assert.match(onboarding, /Tone does not change language/);
    assert.match(compiler, /Tone is manner only/);
    assert.doesNotMatch(compiler, /one steady persona \(warm, calm, everyday/);
  });

  it('does not mention Sheng on the owner tone control', () => {
    assert.doesNotMatch(form, /Sheng/);
    assert.doesNotMatch(wizard, /Sheng/);
  });
});

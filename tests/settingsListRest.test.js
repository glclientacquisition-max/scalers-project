const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("settings list rest", () => {
  // Settings form copy: TenantForm plus the Identity cards (settings remake slice 1).
  const form = read("dashboard/src/components/TenantForm.tsx") + read("dashboard/src/components/identity/IdentitySettings.tsx");
  const scope = read("dashboard/src/lib/settingsSaveScope.ts");
  const handoff = read("dashboard/src/lib/handoffMode.ts");
  const wizard = read("dashboard/src/app/onboarding/OnboardingWizard.tsx");
  const testLine = read("dashboard/src/components/TestLinePanel.tsx");
  const alerts = read("dashboard/src/components/NotifyChannelPicker.tsx");
  const faqs = read("dashboard/src/lib/faqs.ts");

  // Design since #121 / catalogue import: paste lives behind a "Paste list" button that opens
  // CatalogImportSheet (closed by default), not an inline <details>. The rest is the same.
  it("keeps paste behind a closed sheet for services and products", () => {
    const servicesHeader = form.slice(form.indexOf(">Services<"), form.indexOf("<CatalogImportSheet"));
    assert.match(servicesHeader, /Add service/);
    assert.match(servicesHeader, /Paste list/);
    assert.match(servicesHeader, /setServicesImportOpen\(true\)/);
    assert.doesNotMatch(servicesHeader, /Add 3/);
    assert.doesNotMatch(form, /<details[^>]*\sopen[\s>]/);
    assert.match(form, /open=\{servicesImportOpen\}[\s\S]{0,200}title="Paste services"/);
    const productsHeader = form.slice(form.indexOf(">Products<"), form.indexOf('title="Paste products"'));
    assert.match(productsHeader, /Add product/);
    assert.match(productsHeader, /setProductsImportOpen\(true\)/);
    assert.match(form, /open=\{productsImportOpen\}[\s\S]{0,200}title="Paste products"/);
    assert.match(form, /\[servicesImportOpen, setServicesImportOpen\] = useState\(false\)/);
    assert.match(form, /\[productsImportOpen, setProductsImportOpen\] = useState\(false\)/);
    assert.match(form, /return rows\.length \? rows\.map\(\(row\) => markSavedRow\(row\)\) : \[emptyService\(\)\]/);
    assert.match(form, /return rows\.length \? rows\.map\(\(row\) => markSavedRow\(row\)\) : \[\]/);
  });

  // Places moved out of TenantForm into PlacesEditor (one row per place, details in its sheet).
  it("rests a place on Name and Area and opens the rest from that row", () => {
    const places = read("dashboard/src/components/structured/PlacesEditor.tsx");
    assert.match(places, /Add a place/);
    assert.match(places, /label="Name"/);
    assert.match(places, /label="Area"/);
    assert.match(places, /Landmark \(optional\)/);
    assert.doesNotMatch(form, />Landmark<|>Directions<|>Coverage</);
    assert.doesNotMatch(testLine, /Rings \$\{dest\.name\} during open hours\./);
    assert.doesNotMatch(testLine, /title="Hours"|title="Offer"|title="Handoff"/);
  });

  it("shortens the hours save error and pairs Opens with Closes on the phone", () => {
    assert.match(scope, /return "Set at least one open day\."/);
    assert.doesNotMatch(scope, /Set at least one open day in weekly hours/);
    assert.match(form, /grid-cols-2 gap-2 lg:hidden/);
    assert.match(form, />Opens</);
    assert.match(form, />Closes</);
    assert.match(form, />Day</);
    assert.match(form, />Open</);
    assert.doesNotMatch(form, />When closed</);
    assert.match(form, /label="On a call"/);
  });

  it("shows policy rules only once set (or with old text), plus Add a rule", () => {
    const editor = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/components/structured/PolicyRulesEditor.tsx"), "utf8");
    assert.match(editor, /filter\(\(t\) => rules\[t\] \|\| legacyOnly\(t\)\)/);
    assert.match(editor, /Add a rule/);
    assert.match(form, /<PolicyRulesEditor/);
    assert.match(form, /title="When unsure"/);
    assert.match(form, /<UnknownAnswerField/);
    assert.match(read("dashboard/src/components/UnknownAnswerField.tsx"), /What to say/);
  });

  it("starts FAQs empty, drops the answer count, and does not refill a blank row", () => {
    assert.match(form, /useState<FaqEntry\[\]>\(\(\) => normalizeFaqs\(tenant\.faqs\)\)/);
    assert.doesNotMatch(form, /rows\.length \? rows : \[emptyFaq\(\)\]/);
    assert.doesNotMatch(form, /prev\.length <= 1 \? \[emptyFaq\(\)\]/);
    assert.doesNotMatch(form, /faq\.answer\.length\}\/\{FAQ_ANSWER_MAX\}/);
    assert.match(form, /faqs\.length > 0 \?/);
    assert.match(form, /Add FAQ/);
    assert.match(form, />Question</);
    assert.match(form, />Answer</);
    assert.match(faqs, /export const FAQ_STARTERS: FaqEntry\[\] = \[\]/);
  });

  it("shares the live connect sentence on Team and onboarding", () => {
    assert.match(handoff, /export function liveConnectBlurb/);
    assert.match(handoff, /Rings \$\{who\} during open hours\./);
    assert.match(handoff, /Add a team phone\./);
    assert.doesNotMatch(handoff, /Messages a teammate\./);
    assert.match(form, /liveConnectBlurb\(liveDest\?\.name\)/);
    assert.match(form, /Add person/);
    assert.match(wizard, /liveConnectBlurb\(\)/);
    assert.doesNotMatch(form, /Messages a teammate\./);
  });

  it("drops the tone hint under the select", () => {
    assert.match(form, /label="Tone"/);
    assert.match(form, /Assistant name/);
    assert.match(form, /Business name/);
    assert.match(form, /What you do/); // one category question (was Business type + category)
    assert.doesNotMatch(form, /hint=\{TONE_OPTIONS/);
    assert.doesNotMatch(form, /Calm and short\./);
    assert.doesNotMatch(form, /Helpful, like a good receptionist\./);
  });

  it("renames the test preview control to Hear greeting", () => {
    assert.match(testLine, /Hear greeting/);
    assert.doesNotMatch(testLine, /Generate preview/);
    assert.match(testLine, /lineLive/);
    assert.match(testLine, /variant="tonal"/);
    assert.match(testLine, /formatKenyaNumber/);
    assert.match(testLine, /set in Pronunciation/);
    assert.doesNotMatch(testLine, /pronunciation override/);
  });

  it("shows only the greeting on Test Preview", () => {
    assert.match(testLine, /“\{greetingPreview\}”/);
    assert.match(testLine, /text: greetingPreview/);
    assert.doesNotMatch(testLine, /hoursLine/);
    assert.doesNotMatch(testLine, /offerLine/);
    assert.doesNotMatch(testLine, /handoffLine/);
    assert.doesNotMatch(testLine, /formatHoursForCompiler/);
    assert.doesNotMatch(testLine, /summarizeOfferingForIntro/);
    assert.doesNotMatch(testLine, /handoffMessageLine/);
    assert.doesNotMatch(testLine, /firstDialableTeammate/);
    assert.doesNotMatch(testLine, /Rings \$\{dest\.name\} during open hours\./);
    assert.doesNotMatch(testLine, /title="Hours"|title="Offer"|title="Handoff"/);
  });

  it("blocks TenantForm submit while Pronunciation is open", () => {
    // Settings form copy: TenantForm plus the Identity cards (settings remake slice 1).
  const form = read("dashboard/src/components/TenantForm.tsx") + read("dashboard/src/components/identity/IdentitySettings.tsx");
    assert.match(form, /if \(panel === "pronunciation"\) \{\s*event\.preventDefault\(\);/);
    const coach = read("dashboard/src/components/PronunciationCoach.tsx");
    assert.match(coach, /startTransition\(\(\) => geminiAction\(fd\)\)/);
  });

  it("drops alert channel descriptions and keeps Unavailable", () => {
    assert.match(alerts, /Unavailable/);
    assert.match(alerts, /meta\.label/);
    assert.doesNotMatch(alerts, /meta\.description/);
    assert.doesNotMatch(alerts, /unavailableLabel/);
    assert.doesNotMatch(alerts, /Text the owner/);
    assert.doesNotMatch(alerts, /WhatsApp to the alert phone/);
    assert.doesNotMatch(alerts, /Send to the alert email/);
    const panel = read("dashboard/src/components/AlertsPanel.tsx");
    assert.match(panel, /Alert phone/);
    assert.match(panel, /label="Email"/);
    assert.match(panel, /Text customers/);
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("settings list rest", () => {
  const form = read("dashboard/src/components/TenantForm.tsx");
  const scope = read("dashboard/src/lib/settingsSaveScope.ts");
  const handoff = read("dashboard/src/lib/handoffMode.ts");
  const wizard = read("dashboard/src/app/onboarding/OnboardingWizard.tsx");
  const testLine = read("dashboard/src/components/TestLinePanel.tsx");
  const alerts = read("dashboard/src/components/NotifyChannelPicker.tsx");
  const faqs = read("dashboard/src/lib/faqs.ts");

  it("keeps paste behind a closed disclosure and product paste inside it", () => {
    const servicesHeader = form.slice(
      form.indexOf(">Services<"),
      form.indexOf("<details")
    );
    assert.match(servicesHeader, /Add service/);
    assert.doesNotMatch(servicesHeader, /Add 3/);
    assert.doesNotMatch(servicesHeader, /Paste list/);
    const disclosure = form.slice(
      form.indexOf("<details"),
      form.indexOf(">Products<")
    );
    assert.match(disclosure, /<details/);
    assert.doesNotMatch(disclosure, /<details[^>]*\sopen[\s>]/);
    assert.match(disclosure, /Paste list/);
    assert.match(disclosure, /Add 3/);
    assert.match(disclosure, /Paste products/);
    assert.match(disclosure, /name \| price \| notes \| out of scope/);
    const productsHeader = form.slice(
      form.indexOf(">Products<"),
      form.indexOf("products.length === 0")
    );
    assert.match(productsHeader, /Add product/);
    assert.doesNotMatch(productsHeader, /Paste products/);
    assert.match(form, /return rows\.length \? rows : \[emptyService\(\)\]/);
    assert.match(form, /return rows\.length \? rows : \[\]/);
  });

  it("rests a place on Label and Area and opens the rest from that row", () => {
    const places = form.slice(form.indexOf(">Places<"), form.indexOf('panel === "policies"'));
    assert.match(places, /Add place/);
    assert.match(places, />Label</);
    assert.match(places, />Area</);
    const header = places.slice(
      places.indexOf("grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.75rem_2.75rem]"),
      places.indexOf("locations.map")
    );
    assert.doesNotMatch(header, />Landmark</);
    assert.doesNotMatch(header, />Directions</);
    assert.doesNotMatch(header, />Coverage</);
    assert.match(places, /Landmark, directions, and coverage/);
    assert.match(places, /Landmark, directions, and notes/);
    assert.match(places, /vertical === "home_services" \? "Notes" : "Coverage"/);
    assert.match(places, /settingsTrashButtonClass/);
    assert.match(places, /h-11 w-11/);
    assert.match(places, /\{placeOpen \?/);
  });

  it("shortens the hours save error and pairs Opens with Closes on the phone", () => {
    assert.match(scope, /return "Set at least one open day\."/);
    assert.doesNotMatch(scope, /Set at least one open day in weekly hours/);
    assert.match(form, /grid-cols-2 gap-2 lg:hidden/);
    assert.match(form, />Opens</);
    assert.match(form, />Closes</);
    assert.match(form, />Day</);
    assert.match(form, />Open</);
    assert.match(form, />When closed</);
  });

  it("shows policy rules only after they have text, plus Add rule", () => {
    const rules = form.slice(form.indexOf('title="Rules"'), form.indexOf('title="When unsure"'));
    assert.match(rules, /openPolicyIds\.includes\(field\.id\)/);
    assert.match(rules, /Add rule/);
    assert.doesNotMatch(rules, /POLICY_FIELDS\.map\(\(field\)/);
    assert.match(form, /title="When unsure"/);
    assert.match(form, /What to say/);
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
    assert.match(form, /Business type/);
    assert.doesNotMatch(form, /hint=\{TONE_OPTIONS/);
    assert.doesNotMatch(form, /Calm and short\./);
    assert.doesNotMatch(form, /Helpful, like a good receptionist\./);
  });

  it("renames the test preview control to Hear greeting", () => {
    assert.match(testLine, /Hear greeting/);
    assert.doesNotMatch(testLine, /Generate preview/);
    assert.match(testLine, /lineLive/);
    assert.match(testLine, /settingsGhostButtonClass/);
    assert.match(testLine, /settingsPrimaryButtonClass/);
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

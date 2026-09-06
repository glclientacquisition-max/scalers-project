const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("business settings depth", () => {
  const form = read("dashboard/src/components/TenantForm.tsx");
  const policies = read("dashboard/src/lib/businessPolicies.ts");
  const handoff = read("dashboard/src/lib/handoffMode.ts");
  const ingest = read("dashboard/src/components/KnowledgeIngestPanel.tsx");
  const bulletin = read("dashboard/src/components/DailyBulletinPanel.tsx");
  const faqs = read("dashboard/src/lib/faqs.ts");

  it("orders Assistant before Business and uses example placeholders", () => {
    const assistant = form.indexOf(">Assistant<");
    const assistantName = form.indexOf("Assistant name");
    const businessBlock = form.indexOf(">Business<");
    const alerts = form.indexOf(">Alerts<");
    const contacts = form.indexOf(">Public contacts<");
    assert.ok(assistantName > 0);
    assert.ok(assistantName < businessBlock);
    assert.ok(businessBlock < alerts);
    assert.ok(alerts < contacts);
    assert.match(form, /placeholder="Aisha"/);
    assert.match(form, /placeholder="Westlands Books"/);
    assert.match(form, /placeholder="\+254 700 000 000"/);
    assert.doesNotMatch(form, /e\.g\. Aisha|Used for SMS|Owner alert phone/);
  });

  it("uses job labels and example-only policy copy", () => {
    assert.match(form, />When closed</);
    assert.match(form, />When unsure</);
    assert.match(form, /What to say/);
    assert.match(form, /placeholder="Wanjiku Mwangi"/);
    assert.match(form, /Add service/);
    assert.match(form, /placeholder="Shop voice"/);
    assert.match(form, /placeholder="Opposite Naivas"/);
    assert.match(policies, /id: "deposit"/);
    assert.ok(policies.indexOf('id: "payment"') < policies.indexOf('id: "deposit"'));
    assert.ok(policies.indexOf('id: "deposit"') < policies.indexOf('id: "returns"'));
    assert.match(handoff, /label: "Message teammate"/);
    assert.match(handoff, /label: "Connect live call"/);
    assert.doesNotMatch(handoff, /WhatsApp \/ email callback/);
    assert.doesNotMatch(form, /Unknown fallback|Add 1|Front desk voice|Jane Doe/);
  });

  it("keeps import and updates example-first", () => {
    assert.match(ingest, /label: "Paste"/);
    assert.match(ingest, /label: "Website"/);
    assert.match(bulletin, /Callers hear/);
    assert.match(bulletin, /Out of chicken today/);
    assert.match(faqs, /Westlands, opposite Naivas/);
    assert.doesNotMatch(ingest, /Paste your menu/);
    assert.doesNotMatch(form, /Super Admin can add them/);
  });
});

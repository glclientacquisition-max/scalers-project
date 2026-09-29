const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

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
  const alerts = read("dashboard/src/components/AlertsPanel.tsx");
  const alertsActions = read("dashboard/src/app/(desk)/settings/alertsActions.ts");
  const compileActions = read("dashboard/src/app/(desk)/settings/actions.ts");
  const nav = read("dashboard/src/lib/businessSettingsNav.ts");

  it("orders Assistant before Business and uses example placeholders", () => {
    const assistantName = form.indexOf("Assistant name");
    const businessBlock = form.indexOf('title="Business"');
    const contacts = form.indexOf(">Public contacts<");
    assert.ok(assistantName > 0);
    assert.ok(assistantName < businessBlock);
    assert.ok(businessBlock < contacts);
    assert.doesNotMatch(form, />Alerts</);
    assert.match(form, /placeholder="Aisha"/);
    assert.match(form, /placeholder="Westlands Books"/);
    assert.match(form, /placeholder="\+254 700 000 000"/);
    assert.doesNotMatch(form, /e\.g\. Aisha|Used for SMS|Owner alert phone/);
  });

  it("uses job labels and example-only policy copy", () => {
    assert.match(form, />When closed</);
    assert.match(form, /title="When unsure"/);
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
    assert.match(handoff, /Messages a teammate\./);
    assert.doesNotMatch(handoff, /Coming soon/);
    assert.doesNotMatch(handoff, /WhatsApp \/ email callback/);
    assert.match(form, /handoffMessageLine\(liveDest\.name\)/);
    assert.doesNotMatch(form, /Unknown fallback|Add 1|Front desk voice|Jane Doe/);
  });

  it("keeps import and updates example-first", () => {
    assert.match(ingest, /label: "Paste"/);
    assert.match(ingest, /label: "Website"/);
    assert.match(ingest, /knowledgePastePlaceholder/);
    assert.match(bulletin, /Callers hear/);
    assert.match(bulletin, /callersHearPlaceholder/);
    assert.match(bulletin, /SettingsSegmented/);
    assert.match(bulletin, /Until tonight/);
    assert.match(bulletin, /Pick/);
    assert.match(bulletin, /type="date"/);
    assert.match(bulletin, /type="time"/);
    assert.match(form, /servicesPastePlaceholder\(vertical\)/);
    assert.match(faqs, /Westlands, opposite Naivas/);
    assert.doesNotMatch(bulletin, /Out of chicken today/);
    assert.doesNotMatch(form, /Plumbing\\nElectrical/);
    assert.doesNotMatch(ingest, /Home cleaning from 2,500 KES/);
    assert.doesNotMatch(ingest, /Paste your menu/);
    assert.doesNotMatch(form, /Super Admin can add them/);
  });

  it("uses a fixed example per vertical and never chicken for Shop", () => {
    const helperPath = path.join(
      __dirname,
      "../dashboard/src/lib/deskPlaceholders.ts"
    );
    const script = `
      import {
        callersHearPlaceholder,
        servicesPastePlaceholder,
        knowledgePastePlaceholder,
      } from ${JSON.stringify(helperPath)};
      const verticals = ["retail", "home_services", "hospitality", "general"];
      const out = {};
      for (const vertical of verticals) {
        out[vertical] = {
          hear: callersHearPlaceholder(vertical),
          paste: servicesPastePlaceholder(vertical),
          ingest: knowledgePastePlaceholder(vertical),
        };
      }
      console.log(JSON.stringify(out));
    `;
    const ran = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8" }
    );
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const got = JSON.parse(ran.stdout.trim().split("\n").at(-1));
    assert.equal(got.home_services.hear, "Fully booked today");
    assert.equal(got.retail.hear, "Pickup only today");
    assert.equal(got.hospitality.hear, "Fully booked tonight");
    assert.equal(got.general.hear, "Closed today");
    assert.match(got.home_services.paste, /Plumbing/);
    assert.match(got.retail.paste, /Printing - from 500 KES/);
    assert.doesNotMatch(got.retail.paste, /Plumbing|Electrical|Home cleaning/);
    assert.doesNotMatch(got.hospitality.paste, /Plumbing|Home cleaning/);
    assert.doesNotMatch(got.general.paste, /Plumbing|Home cleaning/);
    assert.match(got.retail.ingest, /Westlands Books/);
    assert.doesNotMatch(got.retail.ingest, /Home cleaning/);
    assert.match(got.home_services.ingest, /Home cleaning from 2,500 KES/);
    assert.doesNotMatch(got.home_services.ingest, /Westlands Books/);
    for (const vertical of Object.values(got)) {
      assert.doesNotMatch(vertical.hear, /chicken/i);
      assert.doesNotMatch(vertical.paste, /chicken/i);
      assert.doesNotMatch(vertical.ingest, /chicken/i);
    }
    assert.doesNotMatch(read("dashboard/src/lib/deskPlaceholders.ts"), /Math\.random|chicken/i);
  });

  it("saves alerts on their own panel to the same tenant columns", () => {
    assert.match(nav, /if \(tab === "alerts"\) return "Alerts"/);
    assert.match(alerts, /Alert phone/);
    assert.match(alerts, /Text customers/);
    assert.match(alerts, /Text back missed calls/);
    assert.match(alerts, /placeholder="\+254 700 000 000"/);
    assert.match(alertsActions, /whatsapp_notification_number:/);
    assert.match(alertsActions, /alert_email:/);
    assert.match(alertsActions, /notify_channels: notifyChannels/);
    assert.doesNotMatch(alertsActions, /llm_system_prompt/);
    assert.doesNotMatch(compileActions, /notify_channels/);
    assert.doesNotMatch(compileActions, /whatsapp_notification_number/);
    assert.doesNotMatch(compileActions, /alert_email/);
  });

  it("edits handoff only on Team", () => {
    assert.match(form, /label="Handoff mode"/);
    assert.match(form, /Change in Team/);
    assert.equal((form.match(/setHandoffMode/g) || []).length, 2);
    assert.doesNotMatch(form, /aria-label="Handoff"/);
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("business settings depth", () => {
  // Settings form copy: TenantForm plus the Identity cards (settings remake slice 1).
  const form = read("dashboard/src/components/TenantForm.tsx") + read("dashboard/src/components/identity/IdentitySettings.tsx");
  const policies = read("dashboard/src/lib/businessPolicies.ts");
  const handoff = read("dashboard/src/lib/handoffMode.ts");
  const ingest = read("dashboard/src/components/KnowledgeIngestPanel.tsx");
  const bulletin = read("dashboard/src/components/DailyBulletinPanel.tsx");
  const faqs = read("dashboard/src/lib/faqs.ts");
  const alerts = read("dashboard/src/components/AlertsPanel.tsx");
  const alertsActions = read("dashboard/src/app/(desk)/settings/alertsActions.ts");
  const compileActions = read("dashboard/src/app/(desk)/settings/actions.ts");
  const nav = read("dashboard/src/lib/businessSettingsNav.ts");

  it("orders Identity as business, then how you answer, then contacts, with example placeholders", () => {
    const page = form.slice(form.indexOf("function IdentitySettingsInner"));
    const business = page.indexOf("<BusinessCard");
    const answer = page.indexOf("<AnswerCard");
    const contacts = page.indexOf("<ContactsCard");
    assert.ok(business > 0);
    assert.ok(business < answer);
    assert.ok(answer < contacts);
    assert.match(form, /Assistant name/);
    assert.doesNotMatch(form, />Alerts</);
    assert.match(form, /placeholder="Aisha"/);
    assert.match(form, /placeholder="Westlands Books"/);
    assert.match(require("node:fs").readFileSync(require("path").join(__dirname, "..", "dashboard/src/components/AlertContactsList.tsx"), "utf8"), /"\+254 700 000 000"/);
    assert.doesNotMatch(form, /e\.g\. Aisha|Used for SMS|Owner alert phone/);
  });

  it("uses job labels and example-only policy copy", () => {
    assert.match(form, /label="On a call"/);
    assert.doesNotMatch(form, />When closed</);
    const modes = read("dashboard/src/lib/afterHours.ts");
    assert.match(modes, /label: "Message only"/);
    assert.match(modes, /label: "Full Business Assistant"/);
    assert.match(modes, /Answer questions and take a message/);
    assert.doesNotMatch(modes, /Not ready/);
    assert.doesNotMatch(modes, /disabled:\s*true/);
    assert.doesNotMatch(modes, /Keep helping/);
    assert.doesNotMatch(modes, /missing access|upgrade|Gemini|Soniox|GPT/i);
    assert.match(form, /title="When unsure"/);
    assert.match(read("dashboard/src/components/UnknownAnswerField.tsx"), /What to say/);
    assert.match(require("node:fs").readFileSync(require("path").join(__dirname, "..", "dashboard/src/components/AlertContactsList.tsx"), "utf8"), /"Wanjiku Mwangi"/);
    assert.match(form, /Add service/);
    // The voice label field left with the voice picker (Identity shows the voice by name).
    assert.doesNotMatch(form, /placeholder="Shop voice"/);
    // Place fields live in PlacesEditor now.
    assert.match(read("dashboard/src/components/structured/PlacesEditor.tsx"), /placeholder="Opposite Hilton, Kimathi St"/);
    assert.match(policies, /id: "deposit"/);
    assert.ok(policies.indexOf('id: "payment"') < policies.indexOf('id: "deposit"'));
    assert.ok(policies.indexOf('id: "deposit"') < policies.indexOf('id: "returns"'));
    // Callbacks only (#658): one option, no live call promise.
    assert.match(handoff, /label: "Take a message for a callback"/);
    assert.doesNotMatch(handoff, /label: "Connect live call"/);
    assert.match(handoff, /Add a team phone\./);
    assert.match(handoff, /Rings \$\{who\} during open hours\./);
    assert.doesNotMatch(handoff, /Messages a teammate\./);
    assert.doesNotMatch(handoff, /Coming soon/);
    assert.doesNotMatch(handoff, /WhatsApp \/ email callback/);
    assert.match(form, /liveConnectBlurb\(liveDest\?\.name\)/);
    assert.doesNotMatch(form, /Unknown fallback|Add 1|Front desk voice|Jane Doe/);
  });

  it("keeps import and updates example-first", () => {
    assert.match(ingest, /label: "Text"/);
    assert.match(ingest, /label: "URL"/);
    assert.match(ingest, /label: "CSV"/);
    assert.doesNotMatch(ingest, /Atomic Habits/);
    assert.match(ingest, /useMountedPoolPick/);
    assert.match(ingest, /KNOWLEDGE_PASTE_POOLS/);
    assert.match(bulletin, /Callers hear/);
    assert.match(bulletin, /useMountedPoolPick/);
    assert.match(bulletin, /CALLERS_HEAR_POOLS/);
    assert.match(bulletin, /SettingsSegmented/);
    assert.match(bulletin, /Until tonight/);
    assert.match(bulletin, /Pick/);
    assert.match(bulletin, /type="date"/);
    assert.match(bulletin, /type="time"/);
    assert.match(form, /useMountedPoolPick/);
    assert.match(form, /SERVICES_PASTE_POOLS/);
    assert.match(faqs, /export const FAQ_STARTERS: FaqEntry\[\] = \[\]/);
    assert.doesNotMatch(faqs, /Westlands, opposite Naivas|free parking|M-Pesa|within Nairobi/);
    assert.doesNotMatch(bulletin, /Out of chicken today/);
    assert.doesNotMatch(form, /Plumbing\\nElectrical/);
    assert.doesNotMatch(ingest, /Home cleaning from 2,500 KES/);
    assert.doesNotMatch(ingest, /Paste your menu/);
    assert.doesNotMatch(form, /Super Admin can add them/);
  });

  it("rotates a small example pool per vertical and never chicken for Shop", () => {
    const helperPath = path.join(
      __dirname,
      "../dashboard/src/lib/deskPlaceholders.ts"
    );
    const script = `
      import {
        CALLERS_HEAR_POOLS,
        SERVICES_PASTE_POOLS,
        KNOWLEDGE_PASTE_POOLS,
        placeholderPool,
        pickFromPool,
      } from ${JSON.stringify(helperPath)};
      const verticals = ["retail", "home_services", "hospitality", "general", "other"];
      const tables = {
        hear: CALLERS_HEAR_POOLS,
        paste: SERVICES_PASTE_POOLS,
        ingest: KNOWLEDGE_PASTE_POOLS,
      };
      const out = {};
      for (const vertical of verticals) {
        out[vertical] = {};
        for (const [key, table] of Object.entries(tables)) {
          const pool = placeholderPool(table, vertical);
          const picks = Array.from({ length: 24 }, () => pickFromPool(pool));
          out[vertical][key] = { pool, picks };
        }
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
    const shopTrade = /Plumbing|Electrical|Home cleaning|chicken/i;
    const shopHear = /pickup|delivery|print|paper|binding|A4/i;
    const shopPaste = /print|binding|card|flyer|stamp|photocopy|letterhead|envelope|pickup|delivery|lamination/i;
    const shopIngest = /book|print|stationer|paper|deliver|pick up/i;
    const hsHear = /booked|cleaning|plumb|visit|sofa/i;
    const hsPaste = /clean|plumb|electr|sofa|carpet|mattress|upholster|window/i;
    const night = /tonight|booked|table|kitchen|seating|room|walk-in|breakfast|lodge|restaurant|hotel|checkout|airport|dinner|bed/i;

    for (const vertical of ["retail", "home_services", "hospitality", "general"]) {
      for (const key of ["hear", "paste", "ingest"]) {
        const { pool, picks } = got[vertical][key];
        assert.ok(pool.length >= 3 && pool.length <= 5, `${vertical} ${key} pool size`);
        assert.ok(new Set(picks).size >= 2, `${vertical} ${key} rotates`);
        for (const pick of picks) {
          assert.ok(pool.includes(pick), `${vertical} ${key} pick stays in pool`);
          assert.doesNotMatch(pick, /[—–]|chicken/i);
        }
      }
    }

    for (const line of got.retail.hear.pool) assert.match(line, shopHear);
    for (const line of got.retail.paste.pool) {
      assert.match(line, shopPaste);
      assert.doesNotMatch(line, shopTrade);
    }
    for (const line of got.retail.ingest.pool) {
      assert.match(line, shopIngest);
      assert.doesNotMatch(line, shopTrade);
    }
    for (const line of got.home_services.hear.pool) assert.match(line, hsHear);
    for (const line of got.home_services.paste.pool) assert.match(line, hsPaste);
    assert.match(got.home_services.ingest.pool.join("\n"), /Home cleaning from 2,500 KES/);
    assert.doesNotMatch(got.home_services.ingest.pool.join("\n"), /Westlands Books/);
    for (const line of got.hospitality.hear.pool) assert.match(line, /tonight|booked|table|kitchen|seating|room/i);
    for (const line of got.hospitality.paste.pool) {
      assert.match(line, night);
      assert.doesNotMatch(line, /Plumbing|Home cleaning/);
    }
    assert.doesNotMatch(got.general.paste.pool.join("\n"), /Plumbing|Home cleaning/);
    assert.deepEqual(got.other.hear.pool, got.general.hear.pool);
    assert.match(read("dashboard/src/lib/deskPlaceholders.ts"), /Math\.random/);
    assert.doesNotMatch(read("dashboard/src/lib/deskPlaceholders.ts"), /chicken/i);
    assert.match(read("dashboard/src/lib/useMountedPoolPick.ts"), /pickFromPool/);
  });

  it("saves alerts on their own panel to the same tenant columns", () => {
    assert.match(nav, /if \(tab === "alerts"\) return "How we notify"/);
    assert.match(alerts, /title="How we notify"/);
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

  it("keeps handoff off Voice and drops the one-item Team picker", () => {
    const voiceStart = form.indexOf('panel === "tools"');
    const voice = form.slice(
      voiceStart,
      form.indexOf('panel === "pronunciation"', voiceStart)
    );
    assert.match(voice, /title="Voice"/);
    assert.match(voice, /title="Tools"/);
    // The voice is picked on Identity › How you answer; Voice links there.
    assert.match(voice, /data-voice-moved=""/);
    assert.match(voice, /Change in Identity/);
    assert.doesNotMatch(voice, /id="soniox_voice_id"/);
    assert.match(form, /id="soniox_voice_id"/); // Identity: SettingsSelect wires its own label
    assert.match(form, /Hear it/);
    assert.doesNotMatch(voice, /Handoff/);
    assert.doesNotMatch(voice, /HANDOFF_OPTIONS/);
    assert.doesNotMatch(voice, /Change in Team/);
    assert.doesNotMatch(voice, /label="Handoff mode"/);

    const team = form.slice(
      form.indexOf('panel === "team"'),
      form.indexOf('panel === "faqs"')
    );
    assert.match(team, /Add person/);
    assert.match(team, /\{liveTransferExecutor \? \(/);
    assert.doesNotMatch(team, /handoffMode === "live_transfer" \? \(/);
    // Callbacks only (#658): the blurb shows only with the live executor, never for a stored live_transfer alone.
    assert.match(team, /\{liveTransferExecutor \? \([\s\S]*liveConnectBlurb\(liveDest\?\.name\)/);
    assert.doesNotMatch(team, /liveTransferExecutor \|\| handoffMode === "live_transfer"/);
    assert.equal((team.match(/liveConnectBlurb/g) || []).length, 1);
    assert.match(team, /label="Live connect"/);
    assert.match(team, /<ToolSwitch/);
    assert.match(team, /setHandoffMode\(next \? "live_transfer" : "callback"\)/);
    assert.doesNotMatch(team, /HANDOFF_OPTIONS/);
    assert.doesNotMatch(team, /SettingsSegmented/);
    assert.doesNotMatch(team, /label="Handoff mode"/);
    assert.doesNotMatch(team, /Message teammate/);
    assert.doesNotMatch(team, />Handoff</);
    assert.doesNotMatch(team, /btnPrimaryFill|settingsPrimaryButtonClass/);
    // #655 moved roles to Members (logins); the alert contact list has no Role column.
    assert.match(team, /<AlertContactsList/);
    assert.doesNotMatch(team, /Handles/);
    assert.match(form, /name="handoff_mode"/);
    assert.doesNotMatch(team, /Alert phone/);
    assert.match(alerts, /Alert phone/);
    assert.doesNotMatch(alerts, /Add person/);
    assert.match(read("dashboard/src/components/PhoneAlertsCard.tsx"), /if \(!VAPID_PUBLIC_KEY\) return null/);
  });

  it("names Policies empty next step without inventing Train facts", () => {
    const block = form.slice(
      form.indexOf('panel === "policies"'),
      form.indexOf('panel === "tools"')
    );
    const editor = fs.readFileSync(path.join(__dirname, "..", "dashboard/src/components/structured/PolicyRulesEditor.tsx"), "utf8");
    assert.match(editor, /No rules yet\. Add the ones callers ask about/);
    assert.match(editor, /Add a rule/);
    assert.match(block, /<PolicyRulesEditor/);
    assert.doesNotMatch(block, /Paybill|Till number|KES 500|same-day guarantee/);
  });
});

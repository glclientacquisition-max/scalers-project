// Desk: Settings greeting (tenants.greeting_text + greeting_language).
// Contract: docs/supabase/greeting_language.sql (PR #844). Opening: composeOpening
// in src/speech/callOpening.js (PR #843).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const require = createRequire(import.meta.url);

const g = await import("../dashboard/src/lib/greetingOpening.ts");
const scope = await import("../dashboard/src/lib/settingsSaveScope.ts");

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

// --- Save action patch ------------------------------------------------------

test("save: empty greeting writes NULL", () => {
  assert.deepEqual(g.greetingPatchFromForm(true, form({ greeting_text: "   " })).patch, { greeting_text: null });
  assert.deepEqual(g.greetingPatchFromForm(true, form({ greeting_text: "" })).patch, { greeting_text: null });
});

test("save: greeting text is folded and kept word for word", () => {
  const { patch } = g.greetingPatchFromForm(true, form({ greeting_text: "  Karibu  Esga,\n tukusaidie vipi? " }));
  assert.deepEqual(patch, { greeting_text: "Karibu Esga, tukusaidie vipi?" });
});

test("save: over 240 characters is an error, not a silent clip", () => {
  const res = g.greetingPatchFromForm(true, form({ greeting_text: "a".repeat(241) }));
  assert.ok(res.error);
  assert.deepEqual(res.patch, {});
  assert.equal(g.greetingPatchFromForm(true, form({ greeting_text: "a".repeat(240) })).patch.greeting_text, "a".repeat(240));
});

test("save: language is written only when the owner picked one", () => {
  // No greeting_language field: the stored value (NULL or not) is kept.
  assert.equal("greeting_language" in g.greetingPatchFromForm(true, form({ greeting_text: "Hi" })).patch, false);
  assert.equal(g.greetingPatchFromForm(true, form({ greeting_language: "sw" })).patch.greeting_language, "sw");
  assert.equal(g.greetingPatchFromForm(true, form({ greeting_language: "en" })).patch.greeting_language, "en");
  // Only en and sw: sheng and junk write nothing.
  for (const bad of ["sheng", "fr", "", "SW "]) {
    const patch = g.greetingPatchFromForm(true, form({ greeting_language: bad })).patch;
    if (bad === "SW ") assert.equal(patch.greeting_language, "sw");
    else assert.equal("greeting_language" in patch, false, bad);
  }
});

test("save: panels other than Identity never write the greeting", () => {
  assert.deepEqual(g.greetingPatchFromForm(false, form({ greeting_text: "Hi", greeting_language: "sw" })).patch, {});
  assert.equal(scope.settingsFieldFromScope("identity", "greetingText", true, false), true);
  assert.equal(scope.settingsFieldFromScope("hours", "greetingText", true, false), false);
  assert.equal(scope.settingsFieldFromScope("tools", "greetingText", true, false), false);
});

test("save: a database without the columns saves the rest", () => {
  const patch = { business_name: "Esga", greeting_text: "Hi", greeting_language: "en" };
  const peeled = g.withoutGreetingColumns(
    "Could not find the 'greeting_text' column of 'tenants' in the schema cache",
    patch
  );
  assert.deepEqual(peeled, { business_name: "Esga" });
  assert.equal(g.withoutGreetingColumns("permission denied for table tenants", patch), null);
  assert.equal(g.withoutGreetingColumns("column greeting_text does not exist", { business_name: "x" }), null);
});

test("save action: wired through greetingPatchFromForm with a peel and an owner notice", () => {
  const src = read("dashboard/src/app/(desk)/settings/actions.ts");
  assert.match(src, /greetingPatchFromForm\(\s*settingsFieldFromScope\(scope, "greetingText", true, false\)/);
  assert.match(src, /\.\.\.greeting\.patch/);
  assert.match(src, /withoutGreetingColumns\(error\.message, patch\)/);
  const tenant = read("dashboard/src/lib/tenant.ts");
  assert.match(tenant, /greeting_text, greeting_language/);
  assert.match(tenant, /TENANT_SELECT_NO_GREETING_TEXT/);
});

// --- Preview composition ----------------------------------------------------

const esga = { businessName: "Esga Stationery", agentName: "Wanjiru", greetingInvite: "" };

test("preview: owner text first, then the recording notice", () => {
  const p = g.composeGreetingPreview({ ...esga, greetingText: "Esga Stationery, karibu. Tukusaidie vipi?", greetingLanguage: "sw" });
  assert.equal(p.text, "Esga Stationery, karibu. Tukusaidie vipi? Simu hii inaweza kurekodiwa.");
  assert.equal(p.usesTemplate, false);
  assert.equal(p.languageDetected, false);
});

test("preview: owner text gets a closing full stop only", () => {
  const p = g.composeGreetingPreview({ ...esga, greetingText: "Hello, you have reached Esga", greetingLanguage: "en" });
  assert.equal(p.text, "Hello, you have reached Esga. This call may be recorded.");
});

test("preview: owner text that already mentions recording gets no second notice", () => {
  const p = g.composeGreetingPreview({ ...esga, greetingText: "Esga here. Calls are recorded. How can we help?", greetingLanguage: "en" });
  assert.equal(p.notice, "");
  assert.equal(p.text, "Esga here. Calls are recorded. How can we help?");
});

test("preview: empty greeting falls back to the Voice template", () => {
  assert.equal(
    g.composeGreetingPreview({ ...esga, greetingText: "", greetingLanguage: null }).text,
    "Esga Stationery, this is Wanjiru. This call may be recorded. How can I help?"
  );
  assert.equal(
    g.composeGreetingPreview({ ...esga, greetingText: null, greetingLanguage: "sw" }).text,
    "Hapa ni Esga Stationery, naitwa Wanjiru. Simu hii inaweza kurekodiwa. Nikusaidie vipi?"
  );
  // Default agent name is not spoken; spoken name wins over the business name.
  assert.equal(
    g.composeGreetingPreview({ businessName: "Esga Stationery", spokenName: "Esga", agentName: "Receptionist", greetingInvite: "What can we get you" }).text,
    "Esga. This call may be recorded. What can we get you?"
  );
});

test("preview: NULL language is detected from the owner's words", () => {
  const sw = g.composeGreetingPreview({ ...esga, greetingText: "Karibu Esga, tukusaidie vipi?" });
  assert.equal(sw.language, "sw");
  assert.equal(sw.languageDetected, true);
  assert.match(sw.text, /Simu hii inaweza kurekodiwa\.$/);
  assert.equal(g.composeGreetingPreview({ ...esga, greetingText: "Hello from Esga" }).language, "en");
  // A typed language wins over detection.
  assert.equal(g.composeGreetingPreview({ ...esga, greetingText: "Karibu Esga", greetingLanguage: "en" }).language, "en");
});

test("preview: never offers a language invite", () => {
  for (const lang of ["en", "sw", null]) {
    for (const text of ["", "Karibu Esga"]) {
      const p = g.composeGreetingPreview({ ...esga, greetingText: text, greetingLanguage: lang });
      assert.doesNotMatch(p.text, /English or Kiswahili|Kiingereza au Kiswahili/i);
    }
  }
});

test("preview: recording notice strings match Voice", () => {
  const voice = require("../src/conversation/recordingNotice.js");
  assert.equal(g.RECORDING_NOTICE_EN, voice.RECORDING_NOTICE_EN);
  assert.equal(g.RECORDING_NOTICE_SW, voice.RECORDING_NOTICE_SW);
});

// --- UI ---------------------------------------------------------------------

test("ui: Identity shows the greeting with a counter, segmented language and a preview", () => {
  const ui = read("dashboard/src/components/settings/GreetingSettings.tsx");
  assert.match(ui, /SegmentedControl/);
  assert.match(ui, /\{length\}\/\{GREETING_TEXT_MAX\}/);
  assert.match(ui, /Callers hear/);
  assert.match(ui, /Detected from your greeting/);
  assert.doesNotMatch(ui, /#[0-9a-f]{3,8}\b/i, "no raw hex");
  assert.doesNotMatch(ui, /[\u2013\u2014]/, "no en or em dashes");
  const uiCode = ui.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(uiCode, /\b(tenant|shop)\b/i, "say business");
  const form = read("dashboard/src/components/TenantForm.tsx");
  // The language field is posted only after the owner picks one.
  assert.match(form, /greetingAvailable && greetingLanguagePicked && greetingLanguage \?/);
  assert.match(form, /tenant\.greeting_text !== undefined/);
});

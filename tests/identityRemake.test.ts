// Settings remake slice 1: Identity as three cards that each save on their own.
// Save scopes, the side-nav status, the greeting sentence and the one category question.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const scope = () => import("../dashboard/src/lib/settingsSaveScope.ts");
const greet = () => import("../dashboard/src/lib/identityGreeting.ts");
const status = () => import("../dashboard/src/lib/settingsOptionStatus.ts");
const cat = () => import("../dashboard/src/lib/identityCategory.ts");
const contacts = () => import("../dashboard/src/lib/identityContacts.ts");
const facts = () => import("../dashboard/src/lib/factConfirm.ts");

const ALL = [
  "businessName",
  "vertical",
  "agentName",
  "agentTone",
  "spokenName",
  "greetingInvite",
  "sonioxVoiceId",
  "sonioxVoiceLabel",
  "socialHandles",
  "afterHoursMode",
  "agentTools",
  "servicesCatalog",
  "hoursSchedule",
  "faqs",
  "teamDirectory",
  "businessPolicies",
  "ttsLexicon",
];

test("save scope: each Identity card owns only its own fields", async () => {
  const { settingsScopeIncludes } = await scope();
  const owned = (s: string) => ALL.filter((f) => settingsScopeIncludes(s, f)).sort();
  assert.deepEqual(owned("identity-business"), ["businessName", "vertical"]);
  assert.deepEqual(
    owned("identity-answer"),
    ["agentName", "agentTone", "greetingInvite", "sonioxVoiceId", "sonioxVoiceLabel", "spokenName"]
  );
  assert.deepEqual(owned("identity-contacts"), ["socialHandles"]);
  // The old whole-page scope is the union, for older clients.
  assert.deepEqual(owned("identity"), [...owned("identity-business"), ...owned("identity-answer"), ...owned("identity-contacts")].sort());
});

test("save scope: a card save keeps every other field as stored", async () => {
  const { settingsFieldFromScope } = await scope();
  assert.equal(settingsFieldFromScope("identity-contacts", "businessName", "", "Chapter One"), "Chapter One");
  assert.equal(settingsFieldFromScope("identity-business", "socialHandles", "[]", "stored"), "stored");
  assert.equal(settingsFieldFromScope("identity-answer", "vertical", "general", "retail"), "retail");
  assert.equal(settingsFieldFromScope("identity-answer", "sonioxVoiceId", "new", "old"), "new");
});

test("save scope: the voice moved to Identity, so a Voice save never clobbers it", async () => {
  const { settingsScopeIncludes, settingsFieldFromScope } = await scope();
  assert.equal(settingsScopeIncludes("tools", "sonioxVoiceId"), false);
  assert.equal(settingsScopeIncludes("tools", "sonioxVoiceLabel"), false);
  assert.equal(settingsScopeIncludes("tools", "afterHoursMode"), true);
  assert.equal(settingsScopeIncludes("tools", "agentTools"), true);
  assert.equal(settingsFieldFromScope("tools", "sonioxVoiceId", "form-default", "owner-pick"), "owner-pick");
});

test("save scope: validation follows the card", async () => {
  const { settingsScopeValidationError } = await scope();
  const base = {
    businessName: "",
    agentName: "Aisha",
    servicesCatalogCount: 0,
    productCatalogCount: 0,
    servicesOfferedLength: 0,
    productCatalogMax: 50,
    hasSchedule: false,
    businessHoursLength: 0,
    hasTone: false,
    teamCount: 0,
    faqCount: 0,
    submittedVoiceId: "",
    resolvedVoiceId: null,
    voiceLabel: "",
  };
  assert.equal(settingsScopeValidationError("identity-business", base), "Business name is required.");
  assert.equal(settingsScopeValidationError("identity-contacts", base), null, "contacts do not need a name or tone");
  assert.equal(settingsScopeValidationError("identity-answer", base), "Pick a tone of voice.");
  assert.equal(
    settingsScopeValidationError("identity-answer", { ...base, hasTone: true, submittedVoiceId: "x" }),
    "Pick a voice from the list."
  );
  assert.equal(
    settingsScopeValidationError("tools", { ...base, submittedVoiceId: "x" }),
    null,
    "Voice no longer checks the voice it does not own"
  );
});

test("fact confirm: card scopes confirm only their own facts", async () => {
  const { scopeFactPaths } = await facts();
  assert.deepEqual(scopeFactPaths("identity-business", {}), ["identity.business_name", "identity.vertical"]);
  assert.deepEqual(scopeFactPaths("identity-contacts", {}), ["identity.social_handles"]);
  assert.deepEqual(scopeFactPaths("identity-answer", {}).sort(), ["assistant.agent_name", "assistant.tone", "identity.spoken_name"]);
  const whole = scopeFactPaths("", {});
  assert.equal(whole.filter((p) => p === "identity.business_name").length, 1, "whole form takes identity once");
});

test("greeting sentence: one line built from spoken name and short invite", async () => {
  const { buildGreetingSentence } = await greet();
  assert.equal(
    buildGreetingSentence({ businessName: "Chapter One", spokenName: "Chapter One Books", agentName: "Aisha", greetingInvite: "Which book are you looking for" }).text,
    "Chapter One Books, this is Aisha. Which book are you looking for?"
  );
  assert.equal(
    buildGreetingSentence({ businessName: "Chapter One", agentName: "Receptionist" }).text,
    "Chapter One. How can I help?",
    "no spoken name: the business name; default agent is not said"
  );
  assert.equal(
    buildGreetingSentence({ businessName: "Chapter One", agentName: "Aisha", language: "sw" }).text,
    "Hapa ni Chapter One, naitwa Aisha. Nikusaidie vipi?"
  );
  assert.equal(buildGreetingSentence({ businessName: "Done and Dusted", greetingInvite: "Karibu, tukusaidie vipi", language: "sw" }).invite, "Karibu, tukusaidie vipi?");
  assert.equal(buildGreetingSentence({ businessName: "X", greetingInvite: "We are open till 6" }).invite, "We are open till 6.");
  assert.equal(buildGreetingSentence({ businessName: "X", greetingInvite: "how can I help" }).usesDefaultInvite, true);
  assert.equal(buildGreetingSentence({ businessName: "", spokenName: "" }).text, "", "nothing to say without a name");
  assert.equal(buildGreetingSentence({ businessName: "X", spokenName: "a".repeat(60) }).name.length, 40, "spoken name clips at 40");
});

test("side nav: Identity says Needs setup when the business name or greeting is missing", async () => {
  const { settingsOptionStatus, NEEDS_SETUP } = await status();
  const identity = { tab: "train", panel: "identity" } as const;
  assert.equal(settingsOptionStatus(identity, { business_name: "", spoken_name: "X", agent_tone: "warm" }), NEEDS_SETUP);
  assert.equal(settingsOptionStatus(identity, { business_name: "Chapter One", agent_tone: "warm" }), NEEDS_SETUP);
  assert.equal(settingsOptionStatus(identity, { business_name: "Chapter One", spoken_name: "Chapter One Books", agent_tone: "warm" }), "Warm");
  assert.equal(settingsOptionStatus(identity, { business_name: "Chapter One", greeting_invite: "Karibu", agent_name: "Aisha" }), "Aisha");
});

test("category: one question writes vertical and category the same way as before", async () => {
  const { identityCategoryChoices, currentCategoryChoice, categoryWrites } = await cat();
  const choices = identityCategoryChoices("retail");
  assert.ok(choices.some((c) => c.value === "retail:books_stationery" && c.detail === "Shop"));
  assert.ok(choices.some((c) => c.value === "home_services:cleaning" && c.detail === "Home services"));
  assert.equal(choices.filter((c) => c.vertical === "general").length, 1);
  assert.equal(currentCategoryChoice("retail", "books_stationery"), "retail:books_stationery");
  assert.equal(currentCategoryChoice("retail", "cleaning"), "", "a category from another pack is ignored");
  assert.equal(currentCategoryChoice("general", null), "general:other");
  assert.ok(identityCategoryChoices("hospitality").some((c) => c.vertical === "hospitality"), "legacy pack keeps its row");
  assert.deepEqual(categoryWrites("home_services:cleaning", { vertical: "retail", category: "books_stationery" }), {
    vertical: "home_services",
    category: "cleaning",
    verticalChanged: true,
    categoryChanged: true,
  });
  assert.deepEqual(categoryWrites("retail:", { vertical: "retail", category: "x" }), {
    vertical: "retail",
    category: null,
    verticalChanged: false,
    categoryChanged: false,
  });
});

test("contacts: plain rows", async () => {
  const { formatContactValue, contactRowTitle } = await contacts();
  assert.equal(formatContactValue("whatsapp", "+254712345678"), "0712 345 678");
  assert.equal(formatContactValue("phone", "0712345678"), "0712 345 678");
  assert.equal(formatContactValue("instagram", "@shop"), "@shop");
  assert.equal(contactRowTitle({ kind: "whatsapp", label: "WhatsApp" }), "WhatsApp");
  assert.equal(contactRowTitle({ kind: "phone", label: "Main" }), "Phone");
  assert.equal(contactRowTitle({ kind: "whatsapp", label: "Orders" }), "WhatsApp · Orders");
});

test("render: three cards, each its own form and scope; no spreadsheet; voice moved", () => {
  const page = read("../dashboard/src/components/identity/IdentitySettings.tsx");
  for (const s of ["identity-business", "identity-answer", "identity-contacts"]) {
    assert.match(page, new RegExp(`scope="${s}"`));
  }
  assert.match(page, /title="Your business"/);
  assert.match(page, /title="How you answer"/);
  assert.match(page, /title="How customers reach you"/);
  assert.doesNotMatch(page, /<table|Handle \/ URL/, "contacts are rows, not a table");
  assert.doesNotMatch(page, /greeting_text|greeting_language"/, "never posts greeting_text or greeting_language");
  assert.match(page, /withRoleGate\("settings\.edit"/);
  assert.match(page, /\/api\/pronunciation\/preview/, "Hear it uses the existing preview");
  const copy = page.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(copy, /[\u2013\u2014]/, "no en or em dashes");
  assert.doesNotMatch(copy, /"[^"\n]*\b[Tt]enant\b[^"\n]*"|>[^<>{}\n]*\b[Tt]enant\b[^<>{}\n]*</, "no tenant in copy");
  assert.doesNotMatch(copy, /"[^"\n]*\b[Ss]hop\b[^"\n]*"|>[^<>{}\n]*\b[Ss]hop\b[^<>{}\n]*</, "say business, not shop");
  assert.doesNotMatch(copy, /#[0-9a-f]{3,6}\b/i, "tokens only");
  const form = read("../dashboard/src/components/TenantForm.tsx");
  assert.doesNotMatch(form, /panel === "identity" \? "space-y-3"/, "old Identity section is gone");
  assert.doesNotMatch(form, /id="soniox_voice_id"/, "Voice panel has no voice picker");
  assert.match(form, /data-voice-moved=""/);
  const shell = read("../dashboard/src/components/BusinessSettingsShell.tsx");
  assert.match(shell, /formPanel === "identity" \?/);
});

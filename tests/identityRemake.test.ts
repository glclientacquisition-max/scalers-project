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
  "greetingLanguage",
  "greetingTextClear",
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
    ["agentName", "agentTone", "greetingInvite", "greetingLanguage", "greetingTextClear", "sonioxVoiceId", "sonioxVoiceLabel", "spokenName"]
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

test("side nav: Identity shows the business name, or Needs setup without one", async () => {
  const { settingsOptionStatus, NEEDS_SETUP } = await status();
  const identity = { tab: "train", panel: "identity" } as const;
  assert.equal(settingsOptionStatus(identity, { business_name: "", spoken_name: "X", agent_tone: "warm" }), NEEDS_SETUP);
  assert.equal(settingsOptionStatus(identity, { business_name: "  ", agent_tone: "warm" }), NEEDS_SETUP);
  assert.equal(settingsOptionStatus(identity, { business_name: "Chapter One", agent_tone: "warm" }), "Chapter One", "Automatic greeting is not missing");
  assert.equal(settingsOptionStatus(identity, { business_name: "Chapter One", agent_tone: "professional", agent_name: "Aisha" }), "Chapter One", "never the tone");
  assert.equal(settingsOptionStatus(identity, { business_name: "Westlands Family Bookshop and Stationers" }), "Westlands Family", "long names fit the rail");
});

test("automatic greeting: empty fields, built from the business and assistant names, follows a rename", async () => {
  const { greetingIsAutomatic, buildGreetingSentence } = await greet();
  assert.equal(greetingIsAutomatic({ spokenName: "", greetingInvite: "" }), true);
  assert.equal(greetingIsAutomatic({ spokenName: null, greetingInvite: "How can I help?" }), true, "the stock question is Automatic");
  assert.equal(greetingIsAutomatic({ spokenName: "The business", greetingInvite: "" }), true, "voice ignores the default name");
  assert.equal(greetingIsAutomatic({ spokenName: "Chapter One Books", greetingInvite: "" }), false);
  assert.equal(greetingIsAutomatic({ spokenName: "", greetingInvite: "Which book" }), false);
  const auto = (businessName: string) => buildGreetingSentence({ businessName, agentName: "Aisha" }).text;
  assert.equal(auto("Chapter One Books"), "Chapter One Books, this is Aisha. How can I help?");
  assert.equal(auto("Chapter One Westlands"), "Chapter One Westlands, this is Aisha. How can I help?", "a rename flows through");
});

test("automatic greeting matches the voice line's opening (src/speech/callOpening.js)", async () => {
  const { buildGreetingSentence } = await greet();
  const { composeOpening } = await import("../src/speech/callOpening.js");
  const cases = [
    { businessName: "Chapter One Books", agentName: "Aisha" },
    { businessName: "Chapter One Books", agentName: "Receptionist" },
    { businessName: "Chapter One", spokenName: "Chapter One Books", agentName: "Aisha", greetingInvite: "Which book are you looking for" },
    { businessName: "Done and Dusted", agentName: "Amani", greetingInvite: "Tukusaidie vipi", language: "sw" as const },
    { businessName: "Done and Dusted", agentName: "Amani", language: "sw" as const },
  ];
  for (const c of cases) {
    const voice = composeOpening({ ...c, isOpen: true, recordingNotice: false, isReturning: false, noticeVariant: null });
    assert.equal(buildGreetingSentence(c).text, voice.text, JSON.stringify(c));
  }
});

test("greeting language: Automatic follows the owner's question, else English", async () => {
  const { autoGreetingLanguage, resolveGreetingLanguage } = await greet();
  assert.equal(autoGreetingLanguage(""), "en");
  assert.equal(autoGreetingLanguage("Which book are you looking for"), "en");
  assert.equal(autoGreetingLanguage("Tukusaidie vipi"), "sw");
  assert.equal(autoGreetingLanguage("Karibu, niambie"), "sw");
  assert.equal(resolveGreetingLanguage("auto", "Tukusaidie vipi"), "sw");
  assert.equal(resolveGreetingLanguage("en", "Tukusaidie vipi"), "en");
  assert.equal(resolveGreetingLanguage("sw", ""), "sw");
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
  assert.doesNotMatch(page, /name="greeting_text"/, "never posts greeting_text");
  assert.match(page, /name="greeting_language"/, "How you answer posts the greeting language");
  assert.doesNotMatch(page, /Only Hear it uses this/, "the language pick is saved now");
  assert.match(page, /Returning callers hear the language they used last\./);
  assert.match(page, /Calls also get a short recording notice\./);
  assert.doesNotMatch(page, /data-role-exempt="" data-greeting-language/, "viewers cannot change the saved language");
  assert.match(page, /withRoleGate\("settings\.edit"/);
  assert.match(page, /\/api\/pronunciation\/preview/, "Hear it uses the existing preview");
  assert.match(page, />\s*Automatic\s*</, "Automatic tag");
  assert.match(page, /"Change greeting"/, "one door to the greeting fields");
  assert.match(page, /Use automatic/, "a way back");
  assert.match(page, /rowLabel="Greeting language"/, "language is a one-line row");
  assert.doesNotMatch(page, /Not saved yet/);
  assert.match(page, /max-w-desk/, "MASTER desk width, not max-w-2xl");
  assert.match(page, /xl:grid-cols-2/);
  assert.match(page, /xl:grid-rows-\[auto_1fr\]/, "row 1 never stretches: no dead gap under Your business");
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

// Greeting language saving (tenants.greeting_language: 'en' | 'sw' | null).

test("greeting language: Automatic is null, English en, Kiswahili sw", async () => {
  const { greetingLanguageForStorage, greetingLanguagePickFromStored, parseGreetingLanguageField } = await greet();
  assert.equal(greetingLanguageForStorage("auto"), null);
  assert.equal(greetingLanguageForStorage("en"), "en");
  assert.equal(greetingLanguageForStorage("sw"), "sw");
  assert.equal(greetingLanguagePickFromStored(null), "auto");
  assert.equal(greetingLanguagePickFromStored(""), "auto");
  assert.equal(greetingLanguagePickFromStored("english"), "auto", "only en or sw are stored values");
  assert.equal(greetingLanguagePickFromStored("SW"), "sw");
  assert.equal(greetingLanguagePickFromStored("en"), "en");
  assert.equal(parseGreetingLanguageField("auto"), null);
  assert.equal(parseGreetingLanguageField(""), null);
  assert.equal(parseGreetingLanguageField("sw"), "sw");
  assert.equal(parseGreetingLanguageField("english"), undefined, "invalid keeps the stored value");
});

test("greeting language: only How you answer writes it, and only when posted", async () => {
  const { greetingLanguagePatch } = await scope();
  assert.deepEqual(greetingLanguagePatch("identity-answer", "sw"), { greeting_language: "sw" });
  assert.deepEqual(greetingLanguagePatch("identity-answer", "en"), { greeting_language: "en" });
  assert.deepEqual(greetingLanguagePatch("identity-answer", "auto"), { greeting_language: null });
  assert.deepEqual(greetingLanguagePatch("identity", "sw"), { greeting_language: "sw" }, "whole-page scope is the union");
  assert.deepEqual(greetingLanguagePatch("identity-answer", null), {}, "not posted: stored value stays");
  assert.deepEqual(greetingLanguagePatch("identity-answer", "fr"), {}, "invalid: stored value stays");
  for (const other of ["identity-business", "identity-contacts", "tools", "hours", "catalog", "team", "faqs", "pronunciation", "locations", "policies", ""]) {
    assert.deepEqual(greetingLanguagePatch(other, "sw"), {}, `${other || "unknown scope"} never clobbers the greeting language`);
  }
});

test("greeting language: How you answer does not clobber other cards' fields", async () => {
  const { settingsFieldFromScope, settingsScopeIncludes } = await scope();
  assert.equal(settingsScopeIncludes("identity-answer", "greetingLanguage"), true);
  assert.equal(settingsFieldFromScope("identity-answer", "businessName", "", "Chapter One"), "Chapter One");
  assert.equal(settingsFieldFromScope("identity-answer", "socialHandles", "[]", "stored"), "stored");
  assert.equal(settingsFieldFromScope("identity-answer", "hoursSchedule", null, "stored"), "stored");
  assert.equal(settingsScopeIncludes("identity-business", "greetingLanguage"), false);
  assert.equal(settingsScopeIncludes("identity-contacts", "greetingLanguage"), false);
});

test("save: an RLS-filtered update (0 rows) reports not allowed", async () => {
  const { saveMatchedNoRows } = await scope();
  assert.equal(saveMatchedNoRows(0), true);
  assert.equal(saveMatchedNoRows(1), false);
  assert.equal(saveMatchedNoRows(null), false);
  assert.equal(saveMatchedNoRows(undefined), false);
  const action = read("../dashboard/src/app/(desk)/settings/actions.ts");
  assert.match(action, /update\(patch, \{ count: "exact" \}\)/);
  assert.match(action, /saveMatchedNoRows\(count\)[\s\S]{0,80}deniedMessage\(null, "settings\.edit"\)/);
  assert.match(action, /greetingLanguagePatch\(scope, formData\.get\("greeting_language"\)\)/);
  assert.match(action, /bustTenantCache\(tenant\.id\);[\s\S]{0,200}saveMatchedNoRows/, "cache busts before the 0-row check");
  const page = read("../dashboard/src/app/(desk)/settings/page.tsx");
  assert.match(page, /readGreetingLanguage\(tenant\.id\)/, "Identity loads the stored language");
});

test("greeting language: Automatic order is greeting_text, then the question, else English (Sheng is Kiswahili)", async () => {
  const { autoGreetingLanguage, resolveGreetingLanguage } = await greet();
  assert.equal(autoGreetingLanguage("Which book are you looking for", "Karibu Chapter One, tukusaidie vipi"), "sw", "greeting_text first");
  assert.equal(autoGreetingLanguage("Tukusaidie vipi", "Welcome to Chapter One, how can we help"), "en");
  assert.equal(autoGreetingLanguage("", "Niaje msee, form ni gani"), "sw", "Sheng counts as Kiswahili");
  assert.equal(autoGreetingLanguage("", ""), "en");
  assert.equal(resolveGreetingLanguage("en", "", "Karibu sana"), "en", "a stored choice wins");
});

test("greeting language: Automatic matches the voice line's shopLanguage", async () => {
  const { autoGreetingLanguage } = await greet();
  const { openingLanguageFor } = await import("../src/speech/callOpening.js");
  const lines = [
    ["", ""],
    ["Which book are you looking for", ""],
    ["Tukusaidie vipi", ""],
    ["", "Karibu Chapter One, tukusaidie vipi"],
    ["", "Niaje msee, maze"],
    ["How can I help", "Habari, hapa ni Chapter One. Nikusaidie aje"],
    ["Ninaomba jina lako tafadhali", ""],
    ["Cleaning booking price", ""],
  ];
  for (const [invite, text] of lines) {
    const voice = openingLanguageFor({ greetingInvite: invite, greetingText: text }, {});
    assert.equal(autoGreetingLanguage(invite, text), voice.shopLanguage, JSON.stringify([invite, text]));
  }
});

test("callers hear: templates, Receptionist, custom invite and the recording notice", async () => {
  const { buildGreetingSentence, RECORDING_NOTICE_PREVIEW } = await greet();
  const en = buildGreetingSentence({ businessName: "Chapter One Books", agentName: "Aisha" });
  assert.equal(en.text, "Chapter One Books, this is Aisha. How can I help?");
  assert.equal(en.notice, "For service quality, this call is recorded.");
  const sw = buildGreetingSentence({ businessName: "Chapter One Books", agentName: "Aisha", language: "sw" });
  assert.equal(sw.text, "Hapa ni Chapter One Books, naitwa Aisha. Nikusaidie vipi?");
  assert.equal(sw.notice, "Kwa ubora wa huduma, simu hii inarekodiwa.");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One Books", agentName: "Receptionist" }).text, "Chapter One Books. How can I help?");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One Books", agentName: "" }).text, "Chapter One Books. How can I help?");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One Books", agentName: "receptionist", language: "sw" }).text, "Hapa ni Chapter One Books. Nikusaidie vipi?");
  assert.equal(
    buildGreetingSentence({ businessName: "Chapter One", spokenName: "Chapter One Books", agentName: "Aisha", greetingInvite: "which book are you looking for" }).text,
    "Chapter One Books, this is Aisha. Which book are you looking for?",
    "custom invite kept word for word, only capitalised and closed"
  );
  assert.equal(
    buildGreetingSentence({ businessName: "Chapter One", agentName: "Aisha", greetingInvite: "tell me the book you need" }).invite,
    "Tell me the book you need."
  );
  assert.equal(
    buildGreetingSentence({ businessName: "Chapter One", agentName: "Aisha", greetingInvite: "what can we find for you" }).invite,
    "What can we find for you?"
  );
  const long = "A".repeat(60);
  assert.equal(buildGreetingSentence({ businessName: "x", spokenName: long }).name.length, 40, "spoken name max 40");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One", greetingText: "Karibu Chapter One, rekodi ya simu inaendelea" }).notice, "", "owner already mentions recording");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One", greetingText: "Thanks for calling, this call is recorded" }).notice, "");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One", greetingText: "Thanks for calling Chapter One" }).text, "Thanks for calling Chapter One.");
  assert.equal(buildGreetingSentence({ businessName: "Chapter One", greetingText: "Thanks for calling Chapter One" }).notice, RECORDING_NOTICE_PREVIEW.en);
  assert.equal(buildGreetingSentence({ businessName: "", agentName: "Aisha" }).notice, "", "no notice without a greeting");
});

test("callers hear plus the notice matches the voice line with notice variant b", async () => {
  const { buildGreetingSentence } = await greet();
  const { composeOpening } = await import("../src/speech/callOpening.js");
  const cases = [
    { businessName: "Chapter One Books", agentName: "Aisha" },
    { businessName: "Chapter One Books", agentName: "Receptionist" },
    { businessName: "Done and Dusted", agentName: "Amani", language: "sw" as const },
    { businessName: "Done and Dusted", agentName: "Amani", greetingInvite: "Tukusaidie vipi", language: "sw" as const },
    { businessName: "Chapter One", greetingText: "Thanks for calling Chapter One, how can we help?" },
    { businessName: "Chapter One", greetingText: "Thanks for calling, this call is recorded. How can we help?" },
  ];
  for (const c of cases) {
    const voice = composeOpening({ ...c, isOpen: true, recordingNotice: true, isReturning: false, noticeVariant: "b" });
    const desk = buildGreetingSentence(c);
    assert.equal([desk.text, desk.notice].filter(Boolean).join(" "), voice.text, JSON.stringify(c));
  }
});

test("greeting language markers mirror src/conversation/language.js", async () => {
  const markers = await import("../dashboard/src/lib/greetingLanguageMarkers.ts");
  const src = read("../src/conversation/language.js");
  const grab = (name: string) => {
    const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    assert.ok(m, name);
    return [...m![1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
  };
  assert.deepEqual([...markers.SWAHILI_MARKERS], grab("SWAHILI_MARKERS"));
  assert.deepEqual([...markers.SHENG_MARKERS], grab("SHENG_MARKERS"));
  assert.deepEqual([...markers.ENGLISH_CORE_MARKERS], grab("ENGLISH_CORE_MARKERS"));
  assert.deepEqual([...markers.ENGLISH_JOB_LOANWORDS], grab("ENGLISH_JOB_LOANWORDS"));
});

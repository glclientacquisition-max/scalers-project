// Desk fixes from the Impeccable critique (staging, 28 Oct): greeting states, the item states gate,
// renames, Home calm beta, catalogue units and search count, service words, Kiswahili.
// Run: node --experimental-strip-types --no-warnings --import ./tests/serverOnlyHook.mjs --import ./tests/registerTs.mjs --test tests/critiqueFixes.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

/* ---------------- 1. Identity greeting ---------------- */

test("greeting mode: own words first, then custom, else automatic", async () => {
  const { greetingMode, parseGreetingTextClear } = await import("../dashboard/src/lib/identityGreeting.ts");
  assert.equal(greetingMode({ greetingText: "Karibu Done and Dusted. Tukusaidie vipi?" }), "own");
  assert.equal(greetingMode({ greetingText: "Karibu", spokenName: "Done and Dusted" }), "own");
  assert.equal(greetingMode({ greetingText: "  ", spokenName: "Done and Dusted" }), "custom");
  assert.equal(greetingMode({ greetingInvite: "Which room needs cleaning" }), "custom");
  assert.equal(greetingMode({ greetingText: null, spokenName: "", greetingInvite: "How can I help?" }), "automatic");
  assert.equal(parseGreetingTextClear("1"), true);
  for (const v of ["", "0", "true", null, undefined, "yes"]) assert.equal(parseGreetingTextClear(v), false);
});

test("greeting_text: only How you answer clears it, and only on greeting_text_clear=1", async () => {
  const { greetingTextClearPatch } = await import("../dashboard/src/lib/settingsSaveScope.ts");
  assert.deepEqual(greetingTextClearPatch("identity-answer", "1"), { greeting_text: null });
  assert.deepEqual(greetingTextClearPatch("identity", "1"), { greeting_text: null });
  assert.deepEqual(greetingTextClearPatch("identity-answer", null), {});
  assert.deepEqual(greetingTextClearPatch("identity-answer", "0"), {});
  for (const scope of ["identity-business", "identity-contacts", "hours", "tools", "policies", "catalog", "nope"]) {
    assert.deepEqual(greetingTextClearPatch(scope, "1"), {}, scope);
  }
});

test("greeting_text clear rides the owner-session update and never reaches Brain compile", () => {
  const actions = code("app/(desk)/settings/actions.ts");
  assert.match(actions, /greetingTextClearPatch\(scope, formData\.get\("greeting_text_clear"\)\)/);
  const compile = actions.slice(actions.indexOf("const compileInput = {"), actions.indexOf("};", actions.indexOf("const compileInput = {")));
  assert.doesNotMatch(compile, /greeting/i, "compile input has no greeting fields");
  assert.match(actions, /workspace\.client\.from\("tenants"\)\.update\(patch, \{ count: "exact" \}\)/);
  assert.match(actions, /saveMatchedNoRows\(count\)/, "0 rows reads as not allowed");
});

test("Identity: Your own greeting state, Go back to automatic, Cancel and Escape", () => {
  const page = read("components/identity/IdentitySettings.tsx");
  const copy = code("components/identity/IdentitySettings.tsx");
  assert.match(page, /Your own greeting/);
  assert.match(page, /Go back to automatic/);
  assert.match(page, /Keep my greeting/);
  assert.match(page, /name="greeting_text_clear" value="1"/);
  assert.doesNotMatch(page, /name="greeting_text"/, "Desk never posts a greeting_text of its own");
  // Name and Then asks hide while the owner's own words are said.
  assert.match(page, /editingGreeting && canEdit && mode !== "own"/);
  assert.match(page, /canEdit && mode !== "own" \?/);
  assert.match(page, /data-greeting-cancel=""/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /openedWith\.current = \{ spokenName, greetingInvite \}/, "Cancel restores what was there on open");
  assert.match(page, /Kiswahili when your greeting words are in Kiswahili, else English/);
  assert.doesNotMatch(page, /your question is in/);
  assert.match(page, /xl:grid-rows-\[auto_1fr\]/);
  assert.doesNotMatch(copy, /[\u2013\u2014]/);
});

/* ---------------- 3. Paused / Not offered gate ---------------- */

test("item states flag: off unless DESK_KB_ITEM_STATES is exactly on", async () => {
  const { deskKbItemStates } = await import("../dashboard/src/lib/deskFeatureFlags.ts");
  const was = process.env.DESK_KB_ITEM_STATES;
  try {
    delete process.env.DESK_KB_ITEM_STATES;
    assert.equal(deskKbItemStates(), false);
    for (const v of ["", "1", "true", "ON", "off"]) {
      process.env.DESK_KB_ITEM_STATES = v;
      assert.equal(deskKbItemStates(), false, v);
    }
    process.env.DESK_KB_ITEM_STATES = "on";
    assert.equal(deskKbItemStates(), true);
  } finally {
    if (was === undefined) delete process.env.DESK_KB_ITEM_STATES;
    else process.env.DESK_KB_ITEM_STATES = was;
  }
});

test("Status choices: all three only with the flag; an item already paused keeps its way back", async () => {
  const { statusChoices } = await import("../dashboard/src/lib/catalogueView.ts");
  const v = (xs: { value: string }[]) => xs.map((x) => x.value);
  assert.deepEqual(v(statusChoices(true, "active")), ["active", "paused", "not_offered"]);
  assert.deepEqual(v(statusChoices(false, "active")), []);
  assert.deepEqual(v(statusChoices(false, "paused")), ["active", "paused"]);
  assert.deepEqual(v(statusChoices(false, "not_offered")), ["active", "not_offered"]);
});

test("knowledge page passes the server flag and the What it will say rail", () => {
  const page = read("app/(desk)/settings/knowledge/page.tsx");
  assert.match(page, /statesEnabled=\{deskKbItemStates\(\)\}/);
  assert.match(page, /assistantSayPage=\{deskAssistantSayPage\(\)\}/);
  const screen = read("components/catalogue/CatalogueScreen.tsx");
  assert.match(screen, /statusChoices\(statesEnabled, draft\.status\)/);
  assert.match(screen, /label="Status"/);
  assert.doesNotMatch(screen, /label="Callers hear"/, "Callers hear is only for spoken previews");
  assert.match(screen, /What callers hear/);
});

/* ---------------- 4. Renames ---------------- */

test("Business Assistant nav: On calls, What it can do during a call", async () => {
  const { SETTINGS_NAV, settingsNavDescription, settingsPanelHeading } = await import("../dashboard/src/lib/businessSettingsNav.ts");
  const assistant = SETTINGS_NAV.find((s) => s.id === "assistant")!;
  const tools = assistant.items.find((i) => "tab" in i.target && i.target.tab === "train" && i.target.panel === "tools")!;
  assert.equal(tools.label, "On calls");
  assert.equal(tools.description, "What it can do during a call");
  assert.equal(settingsPanelHeading("train", "tools"), "On calls");
  assert.ok(!SETTINGS_NAV.flatMap((s) => s.items).some((i) => i.label === "Voice"));
  const policies = SETTINGS_NAV.flatMap((s) => s.items).find((i) => i.label === "Policies")!;
  assert.match(settingsNavDescription(policies, "retail"), /delivery, returns/);
  for (const v of ["home_services", "hospitality", "general", null]) {
    assert.doesNotMatch(settingsNavDescription(policies, v), /delivery|returns/, String(v));
  }
});

/* ---------------- 5. Home ---------------- */

test("Home: beta low line is calm; payment fix is a named button; insights top 3", async () => {
  const usage = read("components/HomeUsageSection.tsx");
  assert.match(usage, /isBeta \? "text-ink-2" : "text-warn"/);
  assert.match(read("components/home/HomeOverviewSlots.tsx"), /isBeta=\{isBeta\}/);
  const { readyItemConfirmLink, PAYMENTS_SECTION_HREF } = await import("../dashboard/src/lib/overviewDataChecks.ts");
  const link = readyItemConfirmLink({
    id: "payment",
    label: "Payment details",
    href: "/settings?tab=train&panel=policies",
    complete: false,
    reason: "Payment details are saved but not confirmed. Open Policies and save.",
  });
  assert.deepEqual(link, { href: PAYMENTS_SECTION_HREF, label: "Confirm payment details", reason: "Saved but not confirmed." });
  assert.match(PAYMENTS_SECTION_HREF, /panel=policies#payments$/);
  assert.match(read("components/structured/PaymentsEditor.tsx"), /id="payments"/);
  assert.equal(readyItemConfirmLink({ id: "payment", label: "x", href: "/", complete: true }), null);
  assert.equal(readyItemConfirmLink({ id: "hours", label: "x", href: "/", complete: false, reason: "Add your hours." }), null);
  const card = read("components/HomeGetReadyCallsCard.tsx");
  assert.match(card, /buttonClass\(\{ variant: "tonal", size: "sm"/);
  const insights = read("components/insights/CallInsights.tsx");
  assert.match(insights, /export const INSIGHTS_TOP = 3;/);
  assert.match(insights, /See all \$\{sections\.length\}/);
});

/* ---------------- 6. Catalogue ---------------- */

test("catalogue rows: per job when a service has no unit; search shows a count", async () => {
  const { rowPriceInWords, searchCountLine } = await import("../dashboard/src/lib/catalogueView.ts");
  const base = { price_amount: null, price_min: null, price_max: null, unit: null } as const;
  assert.equal(rowPriceInWords({ ...base, kind: "service", price_mode: "fixed", price_amount: 2500 }), "KSh 2,500 per job");
  assert.equal(rowPriceInWords({ ...base, kind: "service", price_mode: "from", price_amount: 4000 }), "From KSh 4,000 per job");
  assert.equal(rowPriceInWords({ ...base, kind: "service", price_mode: "range", price_min: 6000, price_max: 12000 }), "KSh 6,000 to 12,000 per job");
  assert.equal(rowPriceInWords({ ...base, kind: "service", price_mode: "fixed", price_amount: 150, unit: "kg" }), "KSh 150 per kg");
  assert.equal(rowPriceInWords({ ...base, kind: "service", price_mode: "per_unit", price_amount: 800, unit: "seat" }), "KSh 800 per seat");
  assert.equal(rowPriceInWords({ ...base, kind: "product", price_mode: "fixed", price_amount: 900 }), "KSh 900");
  assert.equal(rowPriceInWords({ ...base, kind: "service", price_mode: "quote" }), "Custom quote");
  assert.equal(searchCountLine(1), "1 result");
  assert.equal(searchCountLine(11), "11 results");
  const screen = read("components/catalogue/CatalogueScreen.tsx");
  assert.match(screen, /data-search-count=/);
  assert.match(screen, /className="me-auto" data-remove-start=""/, "Remove sits apart from Save");
  assert.match(screen, /height="compact"/);
  assert.match(screen, /variant=\{counts\.needPrice \? "tonal" : "primary"\}/, "one filled action: Fix or Add");
  assert.match(read("components/ui/Sheet.tsx"), /height === "compact" && "lg:max-h-\[70dvh\]"/);
});

/* ---------------- 7. Copy ---------------- */

test("done verbs: Hold Done only for a real hold, Mark done for a callback or a home service", async () => {
  const { holdDoneLabel } = await import("../dashboard/src/lib/inboxListVerbs.ts");
  assert.equal(holdDoneLabel({ request_type: "hold_or_pickup" }, "retail"), "Hold Done");
  assert.equal(holdDoneLabel({ request_type: "hold" }), "Hold Done");
  assert.equal(holdDoneLabel({ request_type: "callback" }, "retail"), "Mark done");
  assert.equal(holdDoneLabel({ request_type: "enquiry" }), "Mark done");
  assert.equal(holdDoneLabel({ request_type: "hold_or_pickup" }, "home_services"), "Mark done");
  assert.equal(holdDoneLabel(null), "Mark done");
  const toggle = code("components/RequestStatusToggle.tsx");
  assert.doesNotMatch(toggle, /"Hold Done"/);
  assert.match(read("components/InboxTicketView.tsx"), /requestType=\{hold\.request_type\}/);
});

test("Call back is one spelling; Kiswahili in owner words", async () => {
  const { holdTypeLabel } = await import("../dashboard/src/lib/inboxPurpose.ts");
  assert.equal(holdTypeLabel("callback"), "Call back");
  assert.doesNotMatch(read("lib/capabilityGates.ts"), /title: "Callbacks"/);
  assert.match(read("lib/callInsights.ts"), /r\.language === "sw" \? "Kiswahili"/);
  const { ISSUE_LINE } = await import("../dashboard/src/lib/kbCore.ts");
  for (const line of Object.values(ISSUE_LINE)) assert.doesNotMatch(String(line), /\bSwahili\b/);
});

test("changed owner copy: no dashes, business not tenant or shop, tokens only", () => {
  for (const f of [
    "components/identity/IdentitySettings.tsx",
    "components/catalogue/CatalogueScreen.tsx",
    "components/HomeGetReadyCallsCard.tsx",
    "components/HomeUsageSection.tsx",
    "components/insights/CallInsights.tsx",
    "components/RequestStatusToggle.tsx",
    "lib/businessSettingsNav.ts",
    "lib/overviewDataChecks.ts",
  ]) {
    const c = code(f);
    assert.doesNotMatch(c, /"[^"\n]*[\u2013\u2014][^"\n]*"|>[^<>{}\n]*[\u2013\u2014]/, `${f}: no en or em dash`);
    assert.doesNotMatch(c, /"[^"\n]*\b[Tt]enant\b[^"\n]*"|>[^<>{}\n]*\b[Tt]enant\b[^<>{}\n]*</, `${f}: no tenant`);
    assert.doesNotMatch(c, /#[0-9a-f]{3,6}\b(?![-\w])/i, `${f}: no raw hex`);
  }
});

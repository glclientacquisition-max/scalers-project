// Add many brings in hours, policies, payment, areas and FAQs as one review card per fact (Now vs Found),
// restored after the Import tab was removed (#1040). Each card saves through its own settings action.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildFactCards, factPolicyPatch, foundAreaNames, mightHaveFacts, tickedFacts } from "../dashboard/src/lib/importFactDiff.ts";
import { photoReplyNotes, photoReplyToLines } from "../dashboard/src/lib/importPhoto.ts";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
const week = { timezone: "Africa/Nairobi", location: "", days: { mon: { open: "07:00", close: "19:00" }, sat: { open: "08:00", close: "14:00" } } };
const tenant = {
  business_hours: "Mon-Sat 8am-6pm",
  hours_schedule: null,
  business_locations: [],
  business_policies: { deposit: "50% to book", delivery: "Within Nairobi", provenance: { deposit: { source: "owner" } } },
  faqs: [
    { question: "Do you bring soap?", answer: "Yes.", source: "owner" },
    { question: "Do you work Sundays?", answer: "No.", source: "import" },
    { question: "Is parking free?", answer: "Yes." },
  ],
};
const draft = {
  hoursSchedule: week,
  policies: { deposit: "30% to book", delivery: "Free within 5 km", returns: "", payment: "M-Pesa till 000000" },
  locations: [{ label: "Main", address: "", landmark: "", directions: "", coverage_notes: "We serve Kilimani, Westlands and Karen" }],
  faqs: [
    { question: "do you bring soap", answer: "Yes, we bring everything." },
    { question: "Do you work Sundays?", answer: "Yes, from 9." },
    { question: "Is parking free?", answer: "yes" },
    { question: "Is there a call-out fee?", answer: "KSh 500" },
  ],
};
const cards = buildFactCards({ tenant: tenant as never, draft: draft as never, ownerPaths: new Set(["hours.weekly_grid"]) });
const byId = new Map(cards.map((c) => [c.id, c]));

test("one card per found fact, Now next to Found; same-as-now facts are left out", () => {
  assert.deepEqual(cards.map((c) => c.kind), ["hours", "policy", "policy", "payment", "areas", "faq", "faq", "faq"]);
  assert.equal(byId.get("hours")?.now, "Mon-Sat 8am-6pm");
  assert.equal(byId.get("policy:delivery")?.now, "Within Nairobi");
  assert.equal(byId.get("policy:delivery")?.found, "Free within 5 km");
  assert.equal(byId.get("areas")?.now, "Not set");
  assert.equal(byId.get("areas")?.found, "Add Kilimani, Westlands, Karen");
  assert.equal(cards.some((c) => c.kind === "faq" && c.question === "Is parking free?"), false);
});

test("owner-set facts start unticked, others ticked; payment is never ticked", () => {
  assert.equal(byId.get("hours")?.ownerSet, true);
  assert.equal(byId.get("hours")?.on, false);
  assert.equal(byId.get("policy:deposit")?.on, false, "deposit has owner provenance");
  assert.equal(byId.get("policy:delivery")?.on, true);
  assert.equal(byId.get("payment")?.on, false);
  const faqs = cards.filter((c) => c.kind === "faq");
  assert.deepEqual(faqs.map((c) => [c.kind === "faq" && c.change, c.on]), [["changes", false], ["changes", true], ["new", true]]);
  const fresh = buildFactCards({ tenant: { ...tenant, business_policies: {} } as never, draft: { policies: { payment: "Paybill 000" } } as never });
  assert.equal(fresh[0].kind, "payment");
  assert.equal(fresh[0].on, false, "payment unticked even when nothing is set");
  assert.deepEqual(tickedFacts(cards, { payment: true, "policy:delivery": false }).map((c) => c.id), ["payment", "areas", "faq:1", "faq:3"]);
});

test("never name, type, greeting, team or alert numbers", () => {
  const only = buildFactCards({
    tenant: tenant as never,
    draft: { businessNameSuggestion: "New Name", vertical: "retail", contactPhone: "+254700000000", team: [{ name: "Ann", phone: "+254711111111" }], unknownAnswerFallback: "Ask us" } as never,
  });
  assert.deepEqual(only, []);
  const src = read("dashboard/src/lib/importFactDiff.ts").replace(/\/\*\*[\s\S]*?\*\//g, "");
  for (const field of ["businessNameSuggestion", "contactPhone", "unknownAnswerFallback", "whatsapp_notification_number", "greeting", "team_directory", "d.vertical"]) {
    assert.doesNotMatch(src, new RegExp(field), field);
  }
});

test("areas: matched on the area tree, served and excluded picks kept as they are", () => {
  assert.deepEqual(foundAreaNames(draft.locations as never), ["Kilimani", "Westlands", "Karen"]);
  const areas = byId.get("areas");
  assert.ok(areas && areas.kind === "areas");
  const nodes = areas.picks.picks.map((p) => p.node);
  assert.equal(nodes.length, 3);
  const again = buildFactCards({ tenant: tenant as never, draft: { locations: draft.locations } as never, areas: { picks: areas.picks, confirmed: true } });
  assert.deepEqual(again, [], "already served: no card");
  const excluded = { ...areas.picks, picks: areas.picks.picks.map((p) => ({ ...p, serve: false })) };
  assert.deepEqual(buildFactCards({ tenant: tenant as never, draft: { locations: draft.locations } as never, areas: { picks: excluded, confirmed: false } }), []);
  const one = { ...areas.picks, picks: areas.picks.picks.slice(0, 1) };
  const checked = buildFactCards({ tenant: tenant as never, draft: { locations: draft.locations } as never, areas: { picks: one, confirmed: true } });
  assert.equal(checked[0].on, false, "a checked area list is owner-set");
  assert.equal(checked[0].kind === "areas" && checked[0].picks.picks.length, 3);
});

test("policy and payment cards become a Policies card patch", () => {
  const pay = byId.get("payment");
  const del = byId.get("policy:delivery");
  const dep = byId.get("policy:deposit");
  assert.ok(pay?.kind === "payment" && del?.kind === "policy" && dep?.kind === "policy");
  assert.deepEqual(factPolicyPatch(pay), { text: { payment: "M-Pesa till 000000" } });
  assert.deepEqual(factPolicyPatch(del), { text: { delivery: "Free within 5 km" } });
  assert.deepEqual(factPolicyPatch(dep), { deposit: "30% to book" });
});

test("no model call for a plain price list", () => {
  assert.equal(mightHaveFacts("Deep clean, 6,000\nSofa, 800 per seat"), false);
  assert.equal(mightHaveFacts("Open Monday to Saturday 8 to 6"), true);
  assert.equal(mightHaveFacts("Pay by M-Pesa"), true);
  assert.equal(mightHaveFacts("Do you deliver?"), true);
});

test("photo notes carry the rest of the photo; items unchanged", () => {
  const raw = '{"items":[{"name":"Chapati","price":"KSh 30"}],"notes":"Open daily 7am-9pm. Lipa na M-Pesa till 000000"}';
  assert.equal(photoReplyToLines(raw), "Chapati, KSh 30");
  assert.equal(photoReplyNotes(raw), "Open daily 7am-9pm. Lipa na M-Pesa till 000000");
  assert.equal(photoReplyNotes('{"items":[]}'), "");
});

test("wired into Add many, each card through its own save action, no separate Import page", () => {
  const wire = read("dashboard/src/components/catalogue/KnowledgeCatalogue.tsx");
  assert.match(wire, /card\.kind === "hours"\s*\? await saveOverviewHoursAction\(card\.schedule\)/);
  assert.match(wire, /await savePoliciesCardAction\(factPolicyPatch\(card\)\)/);
  assert.match(wire, /await saveAreaPicksAction\(card\.picks, false\)/);
  assert.match(wire, /await saveFoundFaqAction\(/);
  const faq = read("dashboard/src/app/(desk)/settings/knowledge/foundFactsActions.ts");
  assert.match(faq, /formData\.set\("settings_scope", "faqs"\)/);
  assert.match(faq, /memberDenied\("settings\.edit"\)/);
  assert.doesNotMatch(faq, /\.update\(|\.insert\(|\.upsert\(/);
  const many = read("dashboard/src/app/(desk)/settings/knowledge/addManyActions.ts");
  assert.match(many, /findFactCards\(t, photoReplyNotes\(reply\), "photo"\)/);
  assert.match(many, /findFactCards\(t, plain,/);
  const ui = read("dashboard/src/components/catalogue/CatalogueScreen.tsx");
  assert.match(ui, /data-found-facts=""/);
  assert.match(ui, /findFacts\(factText \?\? body\)/);
  assert.match(ui, /preview\(lines, undefined, raw\)/);
  assert.match(ui, /for \(const card of picked\)/);
  assert.match(ui, /mode === "append" && picked\.length/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "dashboard/src/components/KnowledgeIngestPanel.tsx")), false);
  assert.doesNotMatch(ui, /from "@\/lib\/importFactDiff"/, "the sheet loads the light card module, not the area tree");
});

"use client";

import { CatalogueScreen, type CatalogueActions, type CatalogueScreenProps } from "@/components/catalogue/CatalogueScreen";
import { parsePasteList } from "@/lib/kbCore";
import { buildFactCards, mightHaveFacts } from "@/lib/importFactDiff";

/** Dev only: the real card builder over a fixed found draft, so the sheet shows each card kind. */
const DEV_FACTS = buildFactCards({
  tenant: { business_hours: "Mon-Sat 8am-6pm", hours_schedule: null, business_locations: [], business_policies: { deposit: "50% to book", provenance: { deposit: { source: "owner" } } }, faqs: [{ question: "Do you bring soap?", answer: "Yes.", source: "owner" }] } as never,
  draft: {
    hoursNotes: "Mon-Fri 8 to 6, Sat half day, Sun closed",
    hoursSchedule: { timezone: "Africa/Nairobi", location: "", days: { mon: { open: "07:00", close: "19:00" }, tue: { open: "07:00", close: "19:00" }, wed: { open: "07:00", close: "19:00" }, thu: { open: "07:00", close: "19:00" }, fri: { open: "07:00", close: "19:00" }, sat: { open: "08:00", close: "14:00" }, sun: null } } as never,
    policies: { deposit: "30% to book", delivery: "Free within 5 km", payment: "M-Pesa till 000000" } as never,
    locations: [{ label: "Main", address: "Ngong Road, Kilimani", landmark: "Opposite Prestige Plaza", directions: "", coverage_notes: "Kilimani, Westlands and Karen" }] as never,
    faqs: [{ question: "Do you bring soap?", answer: "Yes, we bring everything." }, { question: "Is there a call-out fee?", answer: "Free within 5 km." }],
  },
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dev only: same screen, actions answered in the browser (paste preview runs the real parser). */
export function DevCatalogue(props: Omit<CatalogueScreenProps, "actions">) {
  const actions: CatalogueActions = {
    saveItem: async () => (await wait(300), { ok: true }),
    hideItem: async () => (await wait(300), { ok: true }),
    decideSwName: async () => ({ ok: true }),
    compile: async () => ({ ok: true }),
    previewPaste: async (text) => {
      await wait(200);
      const rows = parsePasteList(text, props.items);
      return rows.length ? { ok: true, rows } : { ok: false, error: "No items found. Put one item on each line." };
    },
    importPaste: async () => ({ ok: true, importId: "00000000-0000-4000-8000-000000000001" }),
    undoImport: async () => ({ ok: true }),
    photoToLines: async () => (await wait(400), { ok: true, text: "Deep clean, KSh 6,000\nSofa cleaning, 800 per seat" }),
    websiteToLines: async () => (await wait(400), { ok: true, text: "Carpet cleaning KSh 1,500\nMattress cleaning 2,500/=", facts: DEV_FACTS }),
    findFacts: async (text) => (await wait(200), { ok: true, cards: mightHaveFacts(text) ? DEV_FACTS : [] }),
    saveFact: async () => (await wait(150), { ok: true }),
  };
  return <CatalogueScreen {...props} actions={actions} />;
}

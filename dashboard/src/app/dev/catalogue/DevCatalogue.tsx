"use client";

import { CatalogueScreen, type CatalogueActions, type CatalogueScreenProps } from "@/components/catalogue/CatalogueScreen";
import { parsePasteList } from "@/lib/kbCore";
import { buildFactCards, mightHaveFacts } from "@/lib/importFactDiff";

/** Dev only: the real card builder over a fixed found draft, so the sheet shows each card kind. */
const devFacts = (hoursNotes = "Mon-Fri 8 to 6, Sat half day, Sun closed") =>
  buildFactCards({
    tenant: { business_hours: "Mon-Sat 8am-6pm", hours_schedule: null, business_locations: [], business_policies: { deposit: "50% to book", provenance: { deposit: { source: "owner" } } }, faqs: [{ question: "Do you bring soap?", answer: "Yes.", source: "owner" }] } as never,
    draft: {
      hoursNotes,
      hoursSchedule: null as never,
      policies: { deposit: "30% to book", delivery: "Free within 5 km", payment: "M-Pesa till 000000" } as never,
      locations: [
        { label: "Main", address: "Ngong Road, Kilimani", landmark: "Opposite Prestige Plaza", directions: "", coverage_notes: "Kilimani, Westlands and Karen" },
        { label: "Westlands", address: "Mpaka Road, Westlands", landmark: "Next to Sarit Centre", directions: "", coverage_notes: "" },
        { label: "Karen", address: "Karen Road, Karen", landmark: "", directions: "", coverage_notes: "" },
      ] as never,
      faqs: [{ question: "Do you bring soap?", answer: "Yes, we bring everything." }, { question: "Is there a call-out fee?", answer: "Free within 5 km." }],
    },
  });
const DEV_FACTS = devFacts();
/** A pasted "Hours: ..." line is read by the real hours parser, so each hours case can be shown. */
const hoursLine = (text: string) => text.match(/^hours:\s*(.+)$/im)?.[1];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dev only: same screen, actions answered in the browser (paste preview runs the real parser). */
export function DevCatalogue(props: Omit<CatalogueScreenProps, "actions">) {
  const actions: CatalogueActions = {
    saveItem: async () => (await wait(300), { ok: true }),
    hideItem: async () => (await wait(300), { ok: true }),
    decideSwName: async () => (await wait(700), { ok: true }),
    compile: async () => ({ ok: true }),
    previewPaste: async (text) => {
      await wait(200);
      const rows = parsePasteList(text, props.items);
      return rows.length ? { ok: true, rows } : { ok: false, error: "No items found. Put one item on each line." };
    },
    importPaste: async () => (await wait(1200), { ok: true, importId: "00000000-0000-4000-8000-000000000001" }),
    undoImport: async () => (await wait(200), { ok: true, restoreFacts: ["policies", "hours", "locations", "faqs"] }),
    photoToLines: async () => (await wait(400), { ok: true, text: "Deep clean, KSh 6,000\nSofa cleaning, 800 per seat" }),
    websiteToLines: async () => (await wait(400), { ok: true, text: "Carpet cleaning KSh 1,500\nMattress cleaning 2,500/=", facts: DEV_FACTS }),
    findFacts: async (text) => (await wait(200), { ok: true, cards: mightHaveFacts(text) ? devFacts(hoursLine(text)) : [] }),
    saveFact: async () => (await wait(700), { ok: true }),
    factsBegin: async (_k, id) => ({ ok: true, importId: id ?? "00000000-0000-4000-8000-000000000002" }),
    factsEnd: async () => ({ ok: true }),
    restoreFact: async () => (await wait(150), { ok: true }),
  };
  return <CatalogueScreen {...props} actions={actions} />;
}

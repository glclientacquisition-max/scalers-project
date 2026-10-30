"use client";

import { CatalogueScreen, type CatalogueActions, type CatalogueScreenProps } from "./CatalogueScreen";
import {
  compileKbAction,
  decideSwNameAction,
  hideKbItemAction,
  importKbPasteAction,
  previewKbPasteAction,
  saveKbItemAction,
} from "@/app/(desk)/settings/knowledge/actions";
import { photoToLinesAction, websiteToLinesAction } from "@/app/(desk)/settings/knowledge/addManyActions";
import { findFactsAction, saveFoundAddressAction, saveFoundFaqAction } from "@/app/(desk)/settings/knowledge/foundFactsActions";
import { saveOverviewHoursAction } from "@/app/(desk)/settings/overviewActions";
import { savePoliciesCardAction } from "@/app/(desk)/settings/policiesCardActions";
import { saveAreaPicksAction } from "@/app/(desk)/settings/areas/actions";
import { factPolicyPatch, type FactCard } from "@/lib/factCards";

/** Each found fact saves through the action its own settings screen uses (Hours, Policies, Service areas, FAQs). */
async function saveFoundFact(card: FactCard): Promise<{ ok: true } | { ok: false; error: string }> {
  const r =
    card.kind === "hours"
      ? await saveOverviewHoursAction(card.schedule)
      : card.kind === "policy" || card.kind === "payment"
        ? await savePoliciesCardAction(factPolicyPatch(card))
        : card.kind === "address"
          ? await saveFoundAddressAction({ address: card.address, landmark: card.landmark })
          : card.kind === "areas"
          ? await saveAreaPicksAction(card.picks, false)
          : await saveFoundFaqAction({ question: card.question, answer: card.answer });
  return r.ok ? { ok: true } : { ok: false, error: r.error || "Could not save." };
}

const ACTIONS: CatalogueActions = {
  saveItem: saveKbItemAction,
  hideItem: hideKbItemAction,
  decideSwName: decideSwNameAction,
  compile: compileKbAction,
  previewPaste: previewKbPasteAction,
  importPaste: importKbPasteAction,
  photoToLines: photoToLinesAction,
  websiteToLines: websiteToLinesAction,
  findFacts: findFactsAction,
  saveFact: saveFoundFact,
};

/** Settings > Catalogue wired to the KB v2 server actions. */
export function KnowledgeCatalogue(props: Omit<CatalogueScreenProps, "actions">) {
  return <CatalogueScreen {...props} actions={ACTIONS} />;
}

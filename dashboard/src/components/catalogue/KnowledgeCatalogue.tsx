"use client";

import { CatalogueScreen, type CatalogueActions, type CatalogueScreenProps } from "./CatalogueScreen";
import {
  compileKbAction,
  decideSwNameAction,
  hideKbItemAction,
  importKbPasteAction,
  previewKbPasteAction,
  saveKbItemAction,
  setKbCatalogueCompleteAction,
} from "@/app/(desk)/settings/knowledge/actions";

const ACTIONS: CatalogueActions = {
  saveItem: saveKbItemAction,
  hideItem: hideKbItemAction,
  decideSwName: decideSwNameAction,
  compile: compileKbAction,
  previewPaste: previewKbPasteAction,
  importPaste: importKbPasteAction,
  setComplete: setKbCatalogueCompleteAction,
};

/** Settings > Catalogue wired to the KB v2 server actions. */
export function KnowledgeCatalogue(props: Omit<CatalogueScreenProps, "actions">) {
  return <CatalogueScreen {...props} actions={ACTIONS} />;
}

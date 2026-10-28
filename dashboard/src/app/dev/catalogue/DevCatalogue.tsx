"use client";

import { CatalogueScreen, type CatalogueActions, type CatalogueScreenProps } from "@/components/catalogue/CatalogueScreen";
import { parsePasteList } from "@/lib/kbCore";

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
    importPaste: async () => ({ ok: true }),
  };
  return <CatalogueScreen {...props} actions={actions} />;
}

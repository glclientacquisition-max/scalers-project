export type PaneKey = "facts" | "changes" | "history" | "related";
export const PANE_ORDER: readonly PaneKey[] = ["facts", "changes", "history", "related"];
export const PANE_HEADINGS: Record<PaneKey, string> = {
  facts: "Key facts",
  changes: "What will change",
  history: "History",
  related: "Related records",
};

/** Section order is fixed. Empty sections are dropped, never shown as an empty box. */
export function paneSections(s: Partial<Record<PaneKey, unknown[] | undefined>>): PaneKey[] {
  return PANE_ORDER.filter((k) => (s[k]?.length ?? 0) > 0);
}

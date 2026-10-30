/** Add many undo: pure helpers shared by the server log and the Catalogue bar. kb_undo_import enforces the same 10 minutes in SQL. */
export const IMPORT_UNDO_WINDOW_MS = 10 * 60 * 1000;
export type ImportSource = "paste" | "file" | "photo" | "url";

export function importSource(v: unknown): ImportSource {
  return v === "file" || v === "photo" || v === "url" ? v : "paste";
}

/** Whole minutes left in the undo window, rounded up, so "1 minute" shows until the very end. */
export function undoMinutesLeft(at: number, now: number): number {
  return Math.max(0, Math.ceil((at + IMPORT_UNDO_WINDOW_MS - now) / 60_000));
}

/** Owner words for each way undo can be refused. */
export function undoErrorMessage(code: string | undefined): string {
  if (code === "22023") return "It's been more than 10 minutes, so this import can't be undone. Edit the items instead.";
  if (code === "40001") return "Some of these items were changed after the import, so undo is off. Edit them instead.";
  if (code === "P0002") return "We couldn't find that import.";
  return "Couldn't undo. Nothing was changed. Try again.";
}

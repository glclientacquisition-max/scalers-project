/**
 * Stable service ids for `catalog.service.<id>.*` field paths (GIGO confirm v2).
 *
 * Ids are opaque and non-numeric (`svc_` + 16 hex). The settings write path
 * assigns them, so a reorder keeps each row's id and its confirmation. An id
 * is kept only when the stored catalogue already has it; anything else (a new
 * row, a forged or duplicated id) gets a fresh one. Fresh ids are random, so a
 * deleted row's id is never handed to another row.
 *
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */

import { stableRowId } from "./factHash";

export const SERVICE_ID_PREFIX = "svc_";

function randomHex(bytes: number): string {
  const out = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(out);
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newServiceId(taken: Set<string> = new Set()): string {
  for (;;) {
    const id = `${SERVICE_ID_PREFIX}${randomHex(8)}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Give every row a stable id. Rows whose id exists in `stored` keep it (first
 * use only); every other row gets a new id that no stored or submitted row uses.
 */
export function assignServiceIds<T extends Record<string, unknown>>(
  rows: T[],
  stored: Array<Record<string, unknown>> = []
): Array<T & { id: string }> {
  const storedIds = new Set<string>();
  for (const row of stored) {
    const id = stableRowId(row);
    if (id) storedIds.add(id);
  }
  const taken = new Set<string>(storedIds);
  for (const row of rows) {
    const id = stableRowId(row);
    if (id) taken.add(id);
  }
  const used = new Set<string>();
  return rows.map((row) => {
    const id = stableRowId(row);
    if (id && storedIds.has(id) && !used.has(id)) {
      used.add(id);
      return { ...row, id };
    }
    const fresh = newServiceId(taken);
    taken.add(fresh);
    used.add(fresh);
    return { ...row, id: fresh };
  });
}

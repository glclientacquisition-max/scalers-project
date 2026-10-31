import { draftSignature, normalizeDraftValue } from "./formSave.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * How many fields differ between the loaded snapshot and the draft.
 * 0 means nothing to save. NULL, "" and a missing key are the same empty value.
 * Pure: no React, safe to call during render.
 */
export function useDirty(snapshot: unknown, current: unknown): number {
  const left = normalizeDraftValue(snapshot);
  const right = normalizeDraftValue(current);
  if (draftSignature(left) === draftSignature(right)) return 0;
  if (Array.isArray(left) && Array.isArray(right)) {
    const n = Math.max(left.length, right.length);
    let count = 0;
    for (let i = 0; i < n; i += 1) {
      if (draftSignature(left[i]) !== draftSignature(right[i])) count += 1;
    }
    return count;
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    let count = 0;
    for (const key of keys) {
      if (draftSignature(left[key]) !== draftSignature(right[key])) count += 1;
    }
    return count;
  }
  return 1;
}

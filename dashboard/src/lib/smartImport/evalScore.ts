/**
 * Classification scoring for smart import: does each expected fact land on the right tab?
 * Used by the unit eval (mocked model output) and scripts/eval-smart-import.ts (real model).
 * Pure.
 */
import type { SmartItem, SmartTarget } from "./schema";

export type EvalDoc = { id: string; kind: string; source: string; expected: Array<[string, SmartTarget]>; mock?: unknown[]; unsure?: string[] };

const blob = (i: SmartItem) => [i.name, i.question, i.answer, i.area, i.address, i.text, i.evidence, ...i.aliases].join(" | ").toLowerCase();

/** Item that carries the expected fact (by text), preferring one already on the right tab. */
export function findItem(items: SmartItem[], needle: string, target?: SmartTarget): SmartItem | undefined {
  const n = needle.toLowerCase();
  const hits = items.filter((i) => blob(i).includes(n));
  return hits.find((i) => i.target === target) ?? hits[0];
}

export type EvalScore = {
  total: number;
  correct: number;
  perTarget: Record<string, { total: number; correct: number }>;
  misses: Array<{ doc: string; fact: string; expected: SmartTarget; got: SmartTarget | "missing" }>;
};

export function scoreDocs(results: Array<{ doc: EvalDoc; items: SmartItem[] }>): EvalScore {
  const out: EvalScore = { total: 0, correct: 0, perTarget: {}, misses: [] };
  for (const { doc, items } of results) {
    for (const [fact, target] of doc.expected) {
      const got = findItem(items, fact, target);
      const ok = got?.target === target;
      out.total += 1;
      out.perTarget[target] ??= { total: 0, correct: 0 };
      out.perTarget[target].total += 1;
      if (ok) {
        out.correct += 1;
        out.perTarget[target].correct += 1;
      } else out.misses.push({ doc: doc.id, fact, expected: target, got: got?.target ?? "missing" });
    }
  }
  return out;
}

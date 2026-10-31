/** Today's call_facts.outcome, grouped. Unknown outcomes stay in `other`. */

const ANSWERED = new Set(["info_only", "sale_or_order", "hold", "booking"]);

export type OutcomeSplit = { answered: number; handed: number; hung: number; other: number };

export function splitOutcomes(outcomes: Array<string | null | undefined>): OutcomeSplit {
  const out: OutcomeSplit = { answered: 0, handed: 0, hung: 0, other: 0 };
  for (const raw of outcomes) {
    const id = String(raw || "").trim();
    if (!id) continue;
    if (ANSWERED.has(id)) out.answered += 1;
    else if (id === "callback") out.handed += 1;
    else if (id === "abandoned") out.hung += 1;
    else out.other += 1;
  }
  return out;
}

export function splitTotal(split: OutcomeSplit): number {
  return split.answered + split.handed + split.hung + split.other;
}

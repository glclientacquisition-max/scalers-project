/**
 * Owner-facing setup checklist: the 6 setup steps grouped into 5 items, with
 * "Account created" already ticked, so a new owner starts at "1 of 5 done".
 * Pure, so the setup header, the Home card and tests share one count.
 */

import { SETUP_STEPS, type StepKey } from "./setupFlow";

export type ChecklistKey = "account" | "business" | "says" | "reach" | "connect";

export type ChecklistItem = {
  key: ChecklistKey;
  title: string;
  detail: string;
  /** Setup steps this item covers. Empty: not a setup step. */
  steps: readonly StepKey[];
};

export const SETUP_CHECKLIST: readonly ChecklistItem[] = [
  { key: "account", title: "Account created", detail: "Done", steps: [] },
  { key: "business", title: "Your business", detail: "Name, what you sell, hours", steps: ["business", "catalogue", "hours"] },
  { key: "says", title: "What it says", detail: "Assistant name, common questions", steps: ["voice", "faqs"] },
  { key: "reach", title: "Where we reach you", detail: "Your mobile for alerts", steps: ["alerts"] },
  { key: "connect", title: "Connect and test", detail: "Share or forward your number, then test it", steps: [] },
];

export const CHECKLIST_TOTAL = SETUP_CHECKLIST.length;

export type ChecklistProgress = { done: ReadonlySet<ChecklistKey>; count: number; current: ChecklistKey | null };

function lastStepIndex(item: ChecklistItem): number {
  return Math.max(...item.steps.map((k) => SETUP_STEPS.findIndex((s) => s.key === k)));
}

/**
 * Progress from the saved setup step (index of the furthest step reached).
 * `setupDone`: setup finished (owner is on Home). `lineTested`: the test call passed.
 */
export function checklistProgress(input: { furthestStep: number; setupDone?: boolean; lineTested?: boolean }): ChecklistProgress {
  const furthest = Math.max(0, Math.floor(Number(input.furthestStep) || 0));
  const done = new Set<ChecklistKey>(["account"]);
  for (const item of SETUP_CHECKLIST) {
    if (item.steps.length === 0) continue;
    if (input.setupDone || furthest > lastStepIndex(item)) done.add(item.key);
  }
  if (input.lineTested) done.add("connect");
  const current = SETUP_CHECKLIST.find((i) => !done.has(i.key))?.key ?? null;
  return { done, count: done.size, current };
}

export function checklistLabel(count: number): string {
  return `${count} of ${CHECKLIST_TOTAL} done`;
}

/** The checklist item a setup step belongs to. */
export function checklistItemForStep(step: StepKey): ChecklistItem {
  return SETUP_CHECKLIST.find((i) => i.steps.includes(step)) ?? SETUP_CHECKLIST[1];
}

import type { HoursSchedule } from "./hoursSchedule";
import type { AreaPicks } from "./areaPicks";

/**
 * Add many, found facts: the card shape the sheet renders and the helpers it needs. Browser-light on purpose (types
 * only from hours and areas), so the Catalogue bundle does not carry the area tree. Cards are built in importFactDiff.
 */
/** Policy text keys a card can set. Payment has its own card and is never preticked. */
export const FACT_POLICY_KEYS = ["delivery", "deposit", "returns", "cancellation", "warranty", "other"] as const;
export type FactPolicyKey = (typeof FACT_POLICY_KEYS)[number];

type CardBase = {
  id: string;
  label: string;
  now: string;
  found: string;
  /** The owner set this themselves (owner provenance), so the card starts unticked. */
  ownerSet: boolean;
  /** Ticked when the sheet opens. Owner-set facts and payment never are. */
  on: boolean;
  /** Why the card opens unticked although nobody set it (hours read from a sentence with a guess). */
  note?: string | null;
};

export type FactCard =
  | (CardBase & { kind: "hours"; schedule: HoursSchedule })
  | (CardBase & { kind: "policy"; key: FactPolicyKey; value: string })
  | (CardBase & { kind: "payment"; value: string })
  | (CardBase & { kind: "address"; address: string; landmark: string })
  | (CardBase & { kind: "areas"; picks: AreaPicks })
  | (CardBase & { kind: "faq"; question: string; answer: string; change: "new" | "changes" });

/** The Policies card patch for a policy or payment card (savePoliciesCardAction merges it onto the stored row). */
export function factPolicyPatch(card: Extract<FactCard, { kind: "policy" | "payment" }>): {
  text?: Record<string, string>;
  deposit?: string;
  other?: string;
} {
  if (card.kind === "payment") return { text: { payment: card.value } };
  if (card.key === "deposit") return { deposit: card.value };
  if (card.key === "other") return { other: card.value };
  return { text: { [card.key]: card.value } };
}

/** "Ticked 3 of 5" style counts for the footer. */
export function tickedFacts(cards: FactCard[], ticks: Record<string, boolean>): FactCard[] {
  return cards.filter((c) => ticks[c.id] ?? c.on);
}

export type FaqChange = "new" | "changes";
export const FAQ_CHANGE_LINE: Record<FaqChange, string> = { new: "New", changes: "Changes your answer" };

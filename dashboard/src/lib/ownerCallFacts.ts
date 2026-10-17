/**
 * The owner's corrected Wanted/Result (call_facts, source=owner) wins over the
 * older calls.primary_intent / calls.resolution in the Inbox and triage.
 * Mapping is the same as the SQL mirror in correct_call_facts.
 */
import taxonomy from "./taxonomy.json" with { type: "json" };

export type OwnerFacts = { intent: string | null; outcome: string | null; source: string | null };
export type Resolution = "resolved" | "needs_human" | "abandoned" | "unresolved" | "unknown";

const LEGACY: Record<string, string> = {
  price_check: "price",
  quote_request: "price",
  availability: "availability",
  product_info: "product_inquiry",
  order_place: "order_enquiry",
  order_status: "order_enquiry",
  hold_or_pickup: "hold_or_pickup",
  book_visit: "book_visit",
  directions: "directions",
  hours: "hours_open",
  complaint: "complaint",
  return_refund: "complaint",
  warranty: "complaint",
  emergency: "emergency",
  human_request: "human",
  general_enquiry: "general_enquiry",
  delivery_question: "general_enquiry",
  payment_question: "general_enquiry",
};

export function legacyIntentFor(intent: string): string {
  return LEGACY[intent] ?? "other";
}

export function resolutionForOutcome(outcome: string): Resolution {
  if (outcome === "callback") return "needs_human";
  if (outcome === "abandoned") return "abandoned";
  if (outcome === "lost") return "unresolved";
  return "resolved";
}

const label = (list: Array<{ id: string; label: string }>, id: string | null) =>
  (id && list.find((x) => x.id === id)?.label) || null;

export function applyOwnerFacts<R extends string>(
  lead: { primaryIntent: string | null; resolution: R },
  facts: OwnerFacts | null | undefined,
): { primaryIntent: string | null; resolution: R | Resolution; wanted: string | null; result: string | null } {
  if (!facts || facts.source !== "owner") return { ...lead, wanted: null, result: null };
  return {
    primaryIntent: facts.intent ? legacyIntentFor(facts.intent) : lead.primaryIntent,
    resolution: facts.outcome ? resolutionForOutcome(facts.outcome) : lead.resolution,
    wanted: label(taxonomy.intents, facts.intent),
    result: label(taxonomy.outcomes, facts.outcome),
  };
}

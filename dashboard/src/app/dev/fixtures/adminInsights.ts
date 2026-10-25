import type { FactRow } from "@/lib/ops/insightsView";

/** Invented counts-only call facts for the insights dev page. No caller data. */
export const ADMIN_INSIGHTS_NOW = "2026-10-22T09:00:00.000Z";

const BIZ: [string, string, number][] = [
  ["00000000-0000-4000-8000-000000000001", "Mama Njeri Hardware", 214],
  ["00000000-0000-4000-8000-000000000002", "Kilele Pharmacy", 156],
  ["00000000-0000-4000-8000-000000000003", "Pwani Auto Spares", 98],
  ["00000000-0000-4000-8000-000000000004", "Baraka Salon", 41],
  ["00000000-0000-4000-8000-000000000005", "Nyota Bakery", 14],
  ["00000000-0000-4000-8000-000000000006", "Tumaini Clinic", 6],
];
export const ADMIN_INSIGHTS_NAMES = new Map(BIZ.map(([id, n]) => [id, n]));

const INTENTS = ["price_check", "price_check", "availability", "product_info", "order_place", "quote_request", "hours", "directions", "order_status", "complaint", "book_visit", "general_enquiry", "wrong_number", "human_request"];
const OUT = ["sale_or_order", "info_only", "info_only", "callback", "lost", "booking", "hold", "transferred", "abandoned"];

export const ADMIN_INSIGHTS_FACTS: FactRow[] = BIZ.flatMap(([id, , n], bi) =>
  Array.from({ length: n }, (_, i) => {
    const k = i * 5 + bi * 3 + (i >> 3);
    const intent = INTENTS[k % INTENTS.length];
    const outcome = bi === 0 && i % 3 === 0 ? "lost" : OUT[(k >> 1) % OUT.length];
    return {
      tenantId: id,
      intent,
      outcome,
      unanswered: (bi === 0 && i % 4 === 0) || i % 11 === 0,
      createdAt: new Date(Date.parse(ADMIN_INSIGHTS_NOW) - ((i * 5 + bi) % 30) * 86400_000 - i * 60_000).toISOString(),
    };
  }),
);

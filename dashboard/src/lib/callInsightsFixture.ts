import type { CallFactRow } from "./callInsights";

/** Deterministic call_facts for the /dev/insights fixture and tests. */
export function fixtureFacts(n: number, seed = 7): CallFactRow[] {
  let x = seed;
  const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const items = ["Unga 2kg", "Cooking oil 1L", "Gas refill 6kg", "Sugar 1kg", "Delivery to Kilimani"];
  const qs = ["Do you deliver to Ruaka?", "Do you take Fuliza?", "Are you open on Sunday?", "Do you sell 13kg gas?"];
  const out: CallFactRow[] = [];
  const base = Date.parse("2026-10-11T09:00:00Z");
  for (let i = 0; i < n; i++) {
    const lost = r() < 0.3;
    const at = new Date(base - Math.floor(r() * 28 * 86400_000)).toISOString();
    out.push({
      call_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      created_at: at,
      outcome: lost ? "lost" : pick(["sale_or_order", "info_only", "callback", "hold"]),
      lost_reason: lost ? pick(["price_too_high", "price_too_high", "out_of_stock", "delivery_fee", "closed_hours"]) : null,
      products_mentioned: r() < 0.8 ? [{ name: pick(items) }] : [],
      price_objection: r() < 0.2,
      objection_price_ksh: r() < 0.5 ? 180 : null,
      unanswered_question: r() < 0.15 ? pick(qs) : null,
      language: pick(["en", "en", "sw", "sheng", "mixed"]),
      time_of_day: null,
      hour_eat: pick([8, 9, 10, 12, 17, 18, 18, 19, 21]),
      dow: Math.floor(r() * 7),
    });
  }
  return out;
}

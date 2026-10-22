import type { UsageCall, UsageInput } from "@/lib/ops/usageView";

/** Synthetic usage: a business that passes its 500 included minutes on day 19. No real data. */
export const ADMIN_USAGE_NOW = "2026-10-22T09:00:00Z";
const RES = ["resolved", "resolved", "resolved", "needs_human", "abandoned", "resolved", "unresolved"];

function calls(): UsageCall[] {
  const out: UsageCall[] = [];
  let n = 0;
  for (let day = 1; day <= 22; day += 1) {
    const perDay = 5 + ((day * 7) % 9) + (day % 7 === 3 ? 6 : 0);
    for (let k = 0; k < perDay; k += 1) {
      n += 1;
      const hour = 5 + ((k * 5 + day) % 12); // UTC → 08:00–19:00 EAT
      const min = (k * 13 + day * 3) % 60;
      out.push({
        id: `call-${String(n).padStart(4, "0")}`,
        createdAt: `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`,
        durationSeconds: 60 + ((n * 37) % 240),
        resolution: RES[n % RES.length],
        intent: null,
      });
    }
  }
  return out.filter((c) => c.createdAt < ADMIN_USAGE_NOW);
}

const CALLS = calls();

export const ADMIN_USAGE: UsageInput = {
  businessName: "Jirani Home Services",
  packageName: "Starter",
  periodStart: "2026-09-30T21:00:00Z",
  periodEnd: "2026-10-31T21:00:00Z",
  includedMinutes: 500,
  meteredSeconds: CALLS.reduce((a, c) => a + c.durationSeconds, 0),
  onDemandEnabled: true,
  onDemandOwedKes: null,
  calls: CALLS,
};

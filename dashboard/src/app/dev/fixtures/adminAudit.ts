import type { ActivityItem } from "@/lib/adminActivityModel";

/** Synthetic audit rows for /dev. Made-up businesses and operators. Dense for blank-band. */
export const ADMIN_AUDIT_BUSINESSES = [
  { id: "t1", name: "Kilele Fitness" },
  { id: "t2", name: "Kilimani Dental Studio" },
  { id: "t3", name: "Kilifi Boat Tours" },
  { id: "t4", name: "Nyali Clinic" },
];

export const ADMIN_AUDIT_ACTORS = ["alvin", "desk", "mercy"];

const TITLES = ["Package changed", "Number assigned", "Hold days set", "Invoice voided", "Operator note"] as const;

export const ADMIN_AUDIT_ITEMS: ActivityItem[] = Array.from({ length: 48 }, (_, i) => {
  const n = i + 1;
  const biz = ADMIN_AUDIT_BUSINESSES[n % ADMIN_AUDIT_BUSINESSES.length];
  const skipBiz = n % 5 === 0;
  return {
    id: `a${n}`,
    when: `${String(22 - (n % 12)).padStart(2, "0")} Oct ${String(8 + (n % 10)).padStart(2, "0")}:${String((n * 7) % 60).padStart(2, "0")}`,
    title: TITLES[n % TITLES.length],
    business: skipBiz ? null : biz.name,
    businessId: skipBiz ? null : biz.id,
    actor: ADMIN_AUDIT_ACTORS[n % ADMIN_AUDIT_ACTORS.length],
    reason: n % 3 === 0 ? "Policy" : null,
    preview: skipBiz ? `Platform · ${n}` : `${biz.name.split(" ")[0]} · ${n}`,
    changes: [
      { field: "Value", before: String(n - 1), after: String(n) },
      ...(n % 4 === 0 ? [{ field: "Note", before: "", after: "Staff follow-up" }] : []),
    ],
  };
});

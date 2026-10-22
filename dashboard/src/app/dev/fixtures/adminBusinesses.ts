import type { AdminBusiness } from "@/lib/admin";
import type { QualityBadge } from "@/lib/adminQualityModel";

const NAMES = [
  "Jirani Home Services", "Kesho Dental", "Mama Pima Clinic", "Baraka Movers", "Tuko Plumbing", "Nuru Salon",
  "Pwani Car Hire", "Shamba Fresh", "Kilele Fitness", "Upendo Vets", "Riziki Bakery", "Safari Laundry",
  "Mwangaza Optics", "Imara Electric", "Zawadi Florists", "Kona Cafe", "Neema Pharmacy", "Duka Tech Repair",
  "Amani Tutors", "Bahari Fish", "Jua Solar", "Faraja Physio", "Simba Security", "Tamu Catering",
];
const PKG = ["Starter", "Growth", "Business", null] as const;

export const ADMIN_BUSINESSES: AdminBusiness[] = NAMES.map((name, i) => {
  const status: AdminBusiness["status"] = i === 3 || i === 11 ? "waiting" : i === 7 ? "suspended" : i === 22 ? "archived" : "active";
  const id = name.toLowerCase().split(" ")[0];
  return {
    id,
    created_at: new Date(Date.UTC(2026, 6 + (i % 4), 1 + i)).toISOString(),
    business_name: name,
    sautikit_virtual_number: status === "waiting" ? `pending:${id}` : `+2547092215${String(10 + i).padStart(2, "0")}`,
    whatsapp_notification_number: `+2547${String(10000000 + i * 7919).slice(0, 8)}`,
    is_active: status !== "archived",
    archived_at: status === "archived" ? "2026-10-12T09:00:00Z" : null,
    line_status: status === "suspended" ? "suspended" : "active",
    suspended_at: status === "suspended" ? "2026-10-20T08:00:00Z" : null,
    package_name: PKG[i % 4],
    package_period: PKG[i % 4] ? (i % 5 === 0 ? "year" : "month") : null,
    billing_enforcement: i % 3 === 0 ? "hard" : "off",
    status,
    pre_archive: null,
    recording_retention_days_override: null,
  };
});

export const ADMIN_BUSINESS_BADGES: Record<string, QualityBadge> = Object.fromEntries(
  ADMIN_BUSINESSES.slice(0, 18).map((b, i) => [b.id, { score: 6 + ((i * 37) % 40) / 10, dropping: i === 4, droppingReason: i === 4 ? "Answer rate down" : "" }]),
);

const INTENTS = ["booking", "price_question", "directions", "callback_request", "opening_hours", "complaint"];
export const ADMIN_BUSINESS_CALLS = Object.fromEntries(
  ADMIN_BUSINESSES.map((b, bi) => [
    b.id,
    b.status === "waiting" ? [] : Array.from({ length: 10 }, (_, i) => ({
      id: `${b.id}-${i}`,
      created_at: new Date(Date.UTC(2026, 9, 22, 15 - i, 40 - ((i * 13 + bi) % 40))).toISOString(),
      duration_seconds: 30 + ((i * 47 + bi * 11) % 300),
      primary_intent: INTENTS[(i + bi) % INTENTS.length],
      status: "completed",
    })),
  ]),
);

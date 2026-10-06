import { parseFieldSource, type FieldSource } from "./fieldSource";

/** Shop chips. A tap confirms them. Until then they score as seed. */
export const SHOP_SUGGESTED_PRODUCTS = [
  "Chargers",
  "Screen protectors",
  "Earphones",
  "Phone cases",
  "Cables",
] as const;

/** Home chips plus the legacy default service names. */
export const HOME_SUGGESTED_SERVICES = [
  "Home cleaning",
  "Carpet, upholstery, mattress",
  "General repair / maintenance visit",
  "Installation",
  "Inspection / assessment",
  "In-store & online sales",
  "Special orders / sourcing",
  "Delivery",
] as const;

const SEED_POLICY_TEXTS = [
  "M-Pesa and cash. Confirm other methods with the team if asked.",
  "Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.",
  "We can hold items for pickup when we have the caller name and pickup time.",
  "Returns and exchanges follow shop policy. Confirm details with the team if unsure.",
  "Prices vary by title; special orders get a free quotation before you confirm.",
  "M-Pesa and cash after the visit unless agreed otherwise.",
  "We come to you within our service area. Confirm coverage in Train.",
  "Some jobs may need a booking deposit. Confirm with the team.",
  "Call ahead to reschedule or cancel. Same-day cancels may be noted for the team.",
  "Workmanship follows the job quote. Confirm details on site.",
  "True emergencies (burst, flood, fire, gas, shock) are prioritized when the team is available.",
];

const SEED_FAQ_QUESTIONS = [
  "What are your opening hours?",
  "Where are you located?",
  "Do you accept M-Pesa?",
  "Can you hold an item for me?",
  "Do you deliver?",
  "Can you source a book that is not in stock?",
  "Do you come to my location?",
  "Which areas do you cover?",
  "How much does a visit cost?",
  "Can I book a visit over the phone?",
  "Do you clean carpets, couches, or mattresses?",
  "Can I get the same day?",
  "What if it is an emergency?",
];

export const SUGGESTED_FAQ_CHIPS = [
  "What are your opening hours?",
  "Do you accept M-Pesa?",
  "Can you hold an item for me?",
  "Do you deliver?",
  "Which areas do you cover?",
  "Do you come to my location?",
] as const;

function nameKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inList(name: string, list: readonly string[]): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return list.some((item) => nameKey(item) === key);
}

export function isSeedProductName(name: string): boolean {
  return inList(name, SHOP_SUGGESTED_PRODUCTS);
}

export function isSeedServiceName(name: string): boolean {
  return inList(name, HOME_SUGGESTED_SERVICES);
}

export function isSeedPolicyText(text: string): boolean {
  const key = String(text || "").trim();
  if (!key) return false;
  return SEED_POLICY_TEXTS.some((item) => item === key);
}

export function isSeedFaqQuestion(question: string): boolean {
  return inList(question, SEED_FAQ_QUESTIONS);
}

export function jsonFieldSource(raw: unknown): FieldSource | null {
  if (!raw || typeof raw !== "object") return null;
  return parseFieldSource((raw as { source?: unknown }).source);
}

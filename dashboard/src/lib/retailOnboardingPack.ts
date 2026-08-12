import type { FaqEntry } from "@/lib/supabase";
import type { BusinessPolicies } from "@/lib/businessPolicies";
import { emptyPolicies } from "@/lib/businessPolicies";
import {
  parseBulkServices,
  type ServiceItem,
} from "@/lib/servicesCatalog";
import { clampFaq, FAQ_MAX, FAQ_STARTERS } from "@/lib/faqs";

/** Retail-focused golden FAQs seeded at onboarding (owner can edit in Train). */
export const RETAIL_FAQ_STARTERS: FaqEntry[] = [
  {
    question: "What are your opening hours?",
    answer:
      "We are open Monday to Saturday. Confirm the exact times in Train if they differ.",
  },
  {
    question: "Where are you located?",
    answer:
      "Share your shop landmark and street in Train so callers get accurate directions.",
  },
  {
    question: "Do you accept M-Pesa?",
    answer: "Yes, we accept M-Pesa. You can pay on pickup or delivery as arranged.",
  },
  {
    question: "Can you hold an item for me?",
    answer:
      "Yes — tell us the item, your name, and when you will pick up, and we will log a hold.",
  },
  {
    question: "Do you deliver?",
    answer:
      "Yes — same-day in Nairobi for stocked items when available, and countrywide shipping.",
  },
  {
    question: "Can you source a book that is not in stock?",
    answer:
      "Yes — request the title and we will source it, usually with a free quotation first.",
  },
];

export function retailStarterPolicies(): BusinessPolicies {
  return {
    ...emptyPolicies(),
    payment: "M-Pesa and cash. Confirm other methods with the team if asked.",
    delivery:
      "Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.",
    deposit:
      "We can hold items for pickup when we have the caller name and pickup time.",
    returns: "Returns and exchanges follow shop policy — confirm details with the team if unsure.",
    other: "Prices vary by title; special orders get a free quotation before you confirm.",
  };
}

export function retailUnknownFallback(): string {
  return "I don't have that exact detail — I can note it for the team or log a hold/enquiry for you.";
}

/** Build a short services catalog from free-text onboarding (or retail defaults). */
export function seedServicesFromOnboardingText(
  servicesPricing: string,
  vertical: string
): ServiceItem[] {
  const parsed = parseBulkServices(servicesPricing).slice(0, 12);
  if (parsed.length) return parsed;
  if (vertical !== "retail") return [];
  return [
    {
      name: "In-store & online sales",
      price_range: "",
      notes: "Browse and buy stocked items.",
      out_of_scope: "",
      in_stock: "",
      category: "Retail",
    },
    {
      name: "Special orders / sourcing",
      price_range: "Free quotation",
      notes: "Source hard-to-find titles on request.",
      out_of_scope: "",
      in_stock: "",
      category: "Sourcing",
    },
    {
      name: "Delivery",
      price_range: "",
      notes: "Local and countrywide delivery when available.",
      out_of_scope: "",
      in_stock: "",
      category: "Delivery",
    },
  ];
}

export function seedFaqsForVertical(vertical: string): FaqEntry[] {
  const base = vertical === "retail" ? RETAIL_FAQ_STARTERS : FAQ_STARTERS;
  return base.map(clampFaq).slice(0, FAQ_MAX);
}

export function buildRetailOnboardingSeed(opts: {
  vertical: string;
  servicesPricing: string;
  hoursLocation: string;
  landmark?: string;
}): {
  servicesCatalog: ServiceItem[];
  faqs: FaqEntry[];
  businessPolicies: BusinessPolicies | null;
  unknownAnswerFallback: string | null;
} {
  const vertical = String(opts.vertical || "general");
  const faqs = seedFaqsForVertical(vertical).map((f) => {
    // Personalize location FAQ when we have hours/landmark text.
    if (
      /where are you located/i.test(f.question) &&
      (opts.landmark || opts.hoursLocation)
    ) {
      const bits = [opts.landmark, opts.hoursLocation]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      if (bits.length) {
        return clampFaq({
          question: f.question,
          answer: bits.join(". ").slice(0, 400),
        });
      }
    }
    if (/opening hours/i.test(f.question) && opts.hoursLocation) {
      return clampFaq({
        question: f.question,
        answer: opts.hoursLocation.slice(0, 400),
      });
    }
    return f;
  });

  return {
    servicesCatalog: seedServicesFromOnboardingText(
      opts.servicesPricing,
      vertical
    ),
    faqs,
    businessPolicies: vertical === "retail" ? retailStarterPolicies() : null,
    unknownAnswerFallback:
      vertical === "retail" ? retailUnknownFallback() : null,
  };
}

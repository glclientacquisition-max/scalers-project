import type { FaqEntry } from "@/lib/supabase";
import type { BusinessPolicies } from "@/lib/businessPolicies";
import { emptyPolicies } from "@/lib/businessPolicies";
import type { ServiceItem } from "@/lib/servicesCatalog";
import { clampFaq, FAQ_MAX } from "@/lib/faqs";

/** Home-services golden FAQs seeded at onboarding. Beachhead copy is visit + cleaning. */
export const HOME_FAQ_STARTERS: FaqEntry[] = [
  {
    question: "What are your opening hours?",
    answer:
      "We take calls during business hours. Confirm exact times in Train if they differ.",
  },
  {
    question: "Do you come to my location?",
    answer:
      "Yes. We visit clients in our service area. Share your landmark when booking.",
  },
  {
    question: "Which areas do you cover?",
    answer:
      "We cover our listed service areas. Outside coverage we may decline or note a callback honestly.",
  },
  {
    question: "How much does a visit cost?",
    answer:
      "Many jobs are quoted on site from the price band in Train. We never invent a fixed price.",
  },
  {
    question: "Can I book a visit over the phone?",
    answer:
      "Yes. Tell us the service, your name, preferred time window, and landmark.",
  },
  {
    question: "Do you clean carpets, couches, or mattresses?",
    answer:
      "If those jobs are listed in Train, we book them as visits. If not listed, we say so and can note an enquiry.",
  },
  {
    question: "Can I get the same day?",
    answer:
      "If we are open and the time is inside hours, we can take the visit. We do not invent a travel ETA.",
  },
  {
    question: "What if it is an emergency?",
    answer:
      "Burst pipes, flooding, fire, gas, or shock go to the team at once. Same-day cleaning is a normal visit.",
  },
];

export function homeStarterPolicies(): BusinessPolicies {
  return {
    ...emptyPolicies(),
    payment: "M-Pesa and cash after the visit unless agreed otherwise.",
    delivery:
      "We come to you within our service area. Confirm coverage in Train.",
    deposit: "Some jobs may need a booking deposit. Confirm with the team.",
    cancellation:
      "Call ahead to reschedule or cancel. Same-day cancels may be noted for the team.",
    warranty: "Workmanship follows the job quote. Confirm details on site.",
    other: "True emergencies (burst, flood, fire, gas, shock) are prioritized when the team is available.",
  };
}

export function homeUnknownFallback(): string {
  return "I don't have that exact detail. I can note it for the team or book a visit once I have the basics.";
}

export function homeDefaultServices(): ServiceItem[] {
  return [
    {
      name: "Home cleaning",
      price_range: "Quoted on site",
      notes: "House, Airbnb, and general clean visits.",
      out_of_scope: "",
      in_stock: "",
      category: "Cleaning",
    },
    {
      name: "Carpet, upholstery, mattress",
      price_range: "Quoted on site",
      notes: "Couch, carpet, mattress, and fabric cleans.",
      out_of_scope: "",
      in_stock: "",
      category: "Cleaning",
    },
    {
      name: "General repair / maintenance visit",
      price_range: "Quoted on site",
      notes: "Diagnose and fix common household issues.",
      out_of_scope: "",
      in_stock: "",
      category: "Repairs",
    },
    {
      name: "Installation",
      price_range: "Quoted on site",
      notes: "Install fixtures or equipment as listed in Train.",
      out_of_scope: "",
      in_stock: "",
      category: "Install",
    },
    {
      name: "Inspection / assessment",
      price_range: "Quoted on site",
      notes: "On-site assessment before larger jobs.",
      out_of_scope: "",
      in_stock: "",
      category: "Assessment",
    },
  ];
}

export function seedHomeFaqs(): FaqEntry[] {
  return HOME_FAQ_STARTERS.map(clampFaq).slice(0, FAQ_MAX);
}

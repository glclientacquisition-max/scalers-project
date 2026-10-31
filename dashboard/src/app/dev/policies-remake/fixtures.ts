import type { TenantRow } from "@/lib/supabase";

/** A cleaning business: an imported till still to confirm, one rule set, an old returns note. */
export const cleaningTenant = {
  id: "dev-cleaning",
  business_name: "Sparkle Home Cleaners",
  vertical: "home_services",
  business_category: "cleaning",
  unknown_answer_fallback: "",
  unknown_answer_spoken: null,
  tts_lexicon: [],
  soniox_voice_id: null,
  business_policies: {
    payments: {
      version: 2,
      methods: ["mpesa_till", "cash"],
      mpesa_till: "512345",
      mpesa_paybill: null,
      pochi: null,
      mpesa_send: null,
      airtel: null,
      bank: null,
      card: null,
      timings: [],
      deposit_percent: null,
      note: null,
      source: "parsed",
      confirmed: false,
    },
    rules: {
      cancellation: { allowed: true, notice_hours: 24, fee: "none", fee_ksh: null, note: null },
    },
    returns: "Refunds for unused cleaning products within 7 days.",
    provenance: { returns: { source: "owner", confirmed: true } },
    booking_mode: "request",
  },
} as unknown as TenantRow;

/** A fabric shop: Paybill, holds on, returns set, delivery in old free text. */
export const retailTenant = {
  id: "dev-retail",
  business_name: "Mama Njeri Fabrics",
  vertical: "retail",
  business_category: "fabrics",
  unknown_answer_fallback: "Let me ask the shop and call you back.",
  unknown_answer_spoken: null,
  tts_lexicon: [],
  soniox_voice_id: null,
  business_policies: {
    payments: {
      version: 2,
      methods: ["mpesa_paybill", "cash"],
      mpesa_till: null,
      mpesa_paybill: { business_no: "247247", account_mode: "customer_phone", account: null },
      pochi: null,
      mpesa_send: null,
      airtel: null,
      bank: null,
      card: null,
      timings: ["before_delivery", "at_pickup"],
      deposit_percent: null,
      note: null,
      source: "owner",
      confirmed: true,
    },
    rules: {
      returns: { mode: "exchange", days: 7, conditions: ["unused", "receipt"], note: null },
    },
    delivery: "We deliver within Nairobi the same day for orders before 2pm.",
    holds: { allowed: "yes", max_hours: 24, deposit_required: "no", source: "owner", confirmed: true },
    other: "Cut fabric cannot be returned.",
    provenance: {
      delivery: { source: "owner", confirmed: true },
      other: { source: "owner", confirmed: true },
    },
  },
} as unknown as TenantRow;

import { defaultHoursSchedule } from "@/lib/hoursSchedule";
import { parsePaymentsText } from "@/lib/payments";
import type { TenantRow } from "@/lib/supabase";

/** Shared dev tenant for assistant-say fixtures (matches /dev/settings-jobs). */
export const devChapterOneTenant = {
  id: "dev-settings-jobs",
  business_name: "Chapter One",
  sautikit_virtual_number: "+254700000000",
  whatsapp_notification_number: "+254700000000",
  alert_email: "",
  notify_channels: { sms: true, whatsapp: true, email: false },
  llm_system_prompt: "Chapter One answers the phone.",
  services_offered: "Prints",
  services_catalog: [
    {
      name: "A4 print",
      price_range: "20",
      notes: "",
      out_of_scope: "",
      pricing: {
        mode: "fixed",
        amount_ksh: 20,
        min_ksh: null,
        max_ksh: null,
        unit: "item",
        in_stock: true,
        source: "parsed",
        confirmed: false,
        parsed_from: "20",
      },
    },
  ],
  product_catalog: [],
  business_hours: "Mon to Sat, 8 to 6",
  hours_schedule: defaultHoursSchedule("Westlands"),
  agent_name: "Aisha",
  agent_tone: "warm",
  soniox_voice_id: "7b197f3c-84b4-4404-986f-114e4dac1432",
  vertical: "retail",
  team_directory: [{ name: "Amina", role: "Desk", phone: "+254700000001" }],
  faqs: [],
  business_locations: [{ label: "Westlands", address: "Opposite Naivas" }],
  business_policies: {
    payment: "M-Pesa till 123456 or cash on delivery",
    payments: parsePaymentsText("M-Pesa till 123456 or cash on delivery"),
    returns: "Unused within 7 days with receipt",
    extra: { "Minimum order": "KSh 500" },
  },
  is_active: true,
} as unknown as TenantRow;

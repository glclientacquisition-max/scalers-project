import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Strip accidental /rest/v1 suffix from project URL. */
function normalizeSupabaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!rawUrl || !key) {
    throw new Error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  const url = normalizeSupabaseUrl(rawUrl);
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export type LeadStatus = "new" | "contacted" | "resolved";

export type CallRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  caller_number: string;
  sautikit_call_sid: string | null;
  status: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  sentiment: string | null;
  lead_status?: LeadStatus | null;
};

export function parseLeadStatus(raw: unknown): LeadStatus {
  return raw === "contacted" || raw === "resolved" ? raw : "new";
}

export type TranscriptRow = {
  id: string;
  created_at: string;
  call_id: string;
  speaker: string;
  text_content: string;
  latency_ms: number | null;
};

export type TeamDirectoryEntry = {
  name: string;
  role: string;
  phone: string;
  email?: string;
};

export type FaqEntry = {
  question: string;
  answer: string;
};

export type ServiceCatalogEntry = {
  name: string;
  price_range: string;
  notes: string;
  out_of_scope: string;
};

export type HoursScheduleRow = {
  timezone?: string;
  location?: string;
  days?: Record<
    string,
    { open: string; close: string } | null | undefined
  >;
};

export type DailyBulletinEntry = {
  id: string;
  text: string;
  active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at?: string | null;
};

export type TenantRow = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  whatsapp_notification_number: string;
  alert_email?: string | null;
  llm_system_prompt: string | null;
  services_offered?: string | null;
  services_catalog?: ServiceCatalogEntry[] | null;
  business_hours?: string | null;
  hours_schedule?: HoursScheduleRow | null;
  after_hours_mode?: "serve" | "message" | null;
  agent_name?: string | null;
  agent_tone?: string | null;
  team_directory?: TeamDirectoryEntry[] | null;
  faqs?: FaqEntry[] | null;
  unknown_answer_fallback?: string | null;
  daily_bulletin?: DailyBulletinEntry[] | null;
  /** Receptionist tool toggles: escalate, end_call. */
  agent_tools?: { escalate?: boolean; end_call?: boolean } | null;
  /** Business pack: general | retail | home_services | hospitality */
  vertical?: string | null;
  /** Human handoff: callback | live_transfer */
  handoff_mode?: string | null;
  business_locations?: Array<{
    label?: string;
    address?: string;
    landmark?: string;
    directions?: string;
    coverage_notes?: string;
  }> | null;
  business_policies?: {
    returns?: string;
    delivery?: string;
    payment?: string;
    deposit?: string;
    cancellation?: string;
    warranty?: string;
    other?: string;
  } | null;
  wallet_balance_kes?: number | null;
  wallet_low_balance_kes?: number | null;
  billing_enforcement?: "soft" | "hard" | "off" | null;
  /** @deprecated Prefer wallet_balance_kes */
  telecom_wallet_balance_kes?: number | null;
  /** @deprecated AI bundled into wallet_balance_kes */
  ai_wallet_balance_usd?: number | null;
  is_active: boolean | null;
};

export function parseSummary(summary: string | null): Record<string, unknown> {
  if (!summary) return {};
  try {
    const parsed = JSON.parse(summary);
    return parsed && typeof parsed === "object" ? parsed : { text: summary };
  } catch {
    return { text: summary };
  }
}

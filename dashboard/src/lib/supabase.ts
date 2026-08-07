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
};

export type FaqEntry = {
  question: string;
  answer: string;
};

export type TenantRow = {
  id: string;
  business_name: string;
  sautikit_virtual_number: string;
  whatsapp_notification_number: string;
  llm_system_prompt: string | null;
  services_offered?: string | null;
  business_hours?: string | null;
  agent_name?: string | null;
  agent_tone?: string | null;
  team_directory?: TeamDirectoryEntry[] | null;
  faqs?: FaqEntry[] | null;
  unknown_answer_fallback?: string | null;
  telecom_wallet_balance_kes?: number | null;
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

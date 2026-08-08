"use server";

import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  compileReceptionistPrompt,
  parseAgentTone,
} from "@/lib/promptCompiler";
import {
  formatServicesForCompiler,
  normalizeServicesCatalog,
} from "@/lib/servicesCatalog";
import { formatHoursForCompiler, scheduleForForm } from "@/lib/hoursSchedule";
import {
  mergeFaqSuggestions,
  suggestFaqsFromTranscript,
  type FaqSuggestion,
} from "@/lib/faqFromTranscript";
import type { FaqEntry, TeamDirectoryEntry, TranscriptRow } from "@/lib/supabase";
import { parseAgentTools } from "@/lib/agentTools";

export type FaqSuggestState = {
  error?: string;
  ok?: boolean;
  suggestions?: FaqSuggestion[];
  source?: "gemini" | "local";
  message?: string;
};

export type FaqApplyState = {
  error?: string;
  ok?: boolean;
  message?: string;
  source?: "gemini" | "local";
};

const suggestHits = new Map<string, number[]>();

function rateLimitSuggest(tenantId: string): string | null {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 12;
  const prev = (suggestHits.get(tenantId) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    return "You've looked for FAQ ideas a few times. Wait a few minutes, or add FAQs manually in Business settings.";
  }
  prev.push(now);
  suggestHits.set(tenantId, prev);
  return null;
}

function normalizeFaqs(raw: unknown): FaqEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        question: String(r.question || "").trim(),
        answer: String(r.answer || "").trim(),
      };
    })
    .filter((f) => f.question && f.answer);
}

function normalizeTeam(raw: unknown): TeamDirectoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        name: String(r.name || "").trim(),
        role: String(r.role || "").trim(),
        phone: String(r.phone || "").trim(),
        email: String(r.email || "").trim().toLowerCase(),
      };
    })
    .filter((t) => t.name);
}

export async function suggestFaqsFromCallAction(
  _prev: FaqSuggestState,
  formData: FormData
): Promise<FaqSuggestState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to find FAQ ideas." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const tenantId = String(formData.get("tenant_id") || "").trim();
  const callId = String(formData.get("call_id") || "").trim();
  if (!tenantId || tenantId !== tenant.id || !callId) {
    return { error: "Forbidden." };
  }

  const limited = rateLimitSuggest(tenant.id);
  if (limited) return { error: limited };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { data: call, error: callErr } = await workspace.client
    .from("calls")
    .select("id, tenant_id")
    .eq("id", callId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (callErr || !call) {
    return { error: "Call not found." };
  }

  const { data: transcripts, error: txErr } = await workspace.client
    .from("transcripts")
    .select("id, created_at, call_id, speaker, text_content, latency_ms")
    .eq("call_id", callId)
    .order("created_at", { ascending: true });

  if (txErr) {
    return { error: txErr.message };
  }

  const turns = (transcripts || []) as TranscriptRow[];
  if (!turns.length) {
    return { error: "No conversation yet on this call." };
  }

  try {
    const { suggestions, source } = await suggestFaqsFromTranscript({
      turns,
      existingFaqs: normalizeFaqs(tenant.faqs),
      businessName: tenant.business_name,
    });

    if (!suggestions.length) {
      return {
        ok: true,
        suggestions: [],
        source,
        message:
          "No new FAQ ideas from this call. Either it was already covered, or the caller didn’t ask a reusable question.",
      };
    }

    return {
      ok: true,
      suggestions,
      source,
      message: `We found ${suggestions.length} idea${
        suggestions.length === 1 ? "" : "s"
      }. Edit if needed, then add the ones you want.`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not suggest FAQs from this call.",
    };
  }
}

export async function applyFaqSuggestionsAction(
  _prev: FaqApplyState,
  formData: FormData
): Promise<FaqApplyState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to save." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const tenantId = String(formData.get("tenant_id") || "").trim();
  if (!tenantId || tenantId !== tenant.id) return { error: "Forbidden." };

  let picked: FaqEntry[];
  try {
    const raw = JSON.parse(String(formData.get("faqs_json") || "[]")) as unknown;
    if (!Array.isArray(raw)) throw new Error("bad");
    picked = raw
      .map((row) => {
        const r = (row || {}) as Record<string, unknown>;
        return {
          question: String(r.question || "").trim().slice(0, 200),
          answer: String(r.answer || "").trim().slice(0, 400),
        };
      })
      .filter((f) => f.question && f.answer);
  } catch {
    return { error: "Selection expired. Find ideas again." };
  }

  if (!picked.length) {
    return { error: "Tick at least one FAQ and fill in both the question and answer." };
  }

  const agentTone = parseAgentTone(String(tenant.agent_tone || ""));
  if (!agentTone) {
    return {
      error:
        "Pick a tone of voice in Business settings first, save once, then add FAQs here.",
    };
  }

  const schedule = scheduleForForm(tenant.hours_schedule, tenant.business_hours || "");
  const businessHours =
    formatHoursForCompiler(schedule) || String(tenant.business_hours || "").trim();
  if (businessHours.length < 8) {
    return {
      error: "Set your weekly hours in Business settings before adding FAQs.",
    };
  }

  const existingFaqs = normalizeFaqs(tenant.faqs);
  const merged = mergeFaqSuggestions({ existing: existingFaqs, picked });
  if (!merged.added) {
    return {
      ok: true,
      message: "Those FAQs are already on file — nothing new to add.",
    };
  }

  const services = normalizeServicesCatalog(tenant.services_catalog).filter((s) => s.name);
  const servicesOffered =
    formatServicesForCompiler(services, "") ||
    String(tenant.services_offered || "").trim();
  const team = normalizeTeam(tenant.team_directory);
  const agentName = String(tenant.agent_name || "Receptionist").trim() || "Receptionist";
  const unknownAnswerFallback = String(tenant.unknown_answer_fallback || "").trim();

  const agentTools = parseAgentTools(tenant.agent_tools);
  const { prompt, source } = await compileReceptionistPrompt({
    businessName: tenant.business_name,
    servicesOffered,
    businessHours,
    agentTone,
    agentName,
    teamDirectory: team,
    faqs: merged.faqs,
    unknownAnswerFallback,
    escalateEnabled: agentTools.escalate,
  });

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { error } = await workspace.client
    .from("tenants")
    .update({
      faqs: merged.faqs,
      llm_system_prompt: prompt,
    })
    .eq("id", tenant.id);

  if (error) return { error: error.message };

  return {
    ok: true,
    source,
    message: `Added ${merged.added} FAQ${
      merged.added === 1 ? "" : "s"
    }. Live on the next call.`,
  };
}

import { businessSettingsHref, type SettingsPanel } from "@/lib/businessSettingsNav";
import { callsHref } from "@/lib/callsTriage";
import {
  assessMvpAnswerReadiness,
  type MvpReadinessInput,
  type MvpReadinessItem,
} from "@/lib/mvpAnswerReadiness";
import type { TenantRow } from "@/lib/supabase";

export const HOME_LEAD_LIMIT = 8;

export type LineStatus = "line_live" | "number_pending";

export type HomeNextAction = {
  href: string;
  label: string;
};

export function lineStatusFromDid(did: string | null | undefined): LineStatus {
  const value = String(did ?? "").trim();
  if (!value || /^pending:/i.test(value)) return "number_pending";
  return "line_live";
}

export function tenantToReadinessInput(tenant: TenantRow): MvpReadinessInput {
  return {
    businessName: tenant.business_name,
    sautikitVirtualNumber: tenant.sautikit_virtual_number,
    llmSystemPrompt: tenant.llm_system_prompt,
    agentName: tenant.agent_name,
    agentTone: tenant.agent_tone,
    businessHours: tenant.business_hours,
    hoursSchedule: tenant.hours_schedule,
    businessLocations: tenant.business_locations,
    faqs: tenant.faqs,
    unknownAnswerFallback: tenant.unknown_answer_fallback,
    whatsappNotificationNumber: tenant.whatsapp_notification_number,
    alertEmail: tenant.alert_email,
    teamDirectory: tenant.team_directory,
    productCatalog: tenant.product_catalog,
    vertical: tenant.vertical,
    agentTools: tenant.agent_tools,
  };
}

export function assessTenantAnswerReadiness(tenant: TenantRow) {
  return assessMvpAnswerReadiness(tenantToReadinessInput(tenant));
}

/** First required gap the owner can act on. Skip DID when Number pending is already shown. */
export function firstTrainingGap(
  items: MvpReadinessItem[],
  line: LineStatus
): MvpReadinessItem | null {
  return (
    items.find((item) => {
      if (!item.required || item.ok) return false;
      if (line === "number_pending" && item.id === "did") return false;
      return true;
    }) ?? null
  );
}

export function trainingPanelForItem(id: string): SettingsPanel {
  switch (id) {
    case "hours":
    case "hours_schedule":
      return "hours";
    case "location":
      return "locations";
    case "faqs_or_fallback":
      return "faqs";
    default:
      return "identity";
  }
}

export function trainingGapLabel(id: string): string {
  switch (id) {
    case "did":
      return "Number";
    case "prompt":
      return "Prompt";
    case "identity":
      return "Agent";
    case "hours":
    case "hours_schedule":
      return "Hours";
    case "location":
      return "Location";
    case "faqs_or_fallback":
      return "FAQs";
    case "notify":
      return "Notify";
    default:
      return "Setup";
  }
}

export function homeNextAction(input: {
  newLeadCount: number;
  line: LineStatus;
  trainingGapId: string | null;
  walletLow: boolean;
  totalCalls: number | null;
}): HomeNextAction {
  if (input.newLeadCount > 0) {
    return { href: callsHref({ status: "new" }), label: "Process leads" };
  }
  if (input.line === "number_pending") {
    return { href: businessSettingsHref("test"), label: "Test assistant" };
  }
  if (input.trainingGapId) {
    return {
      href: businessSettingsHref("train", trainingPanelForItem(input.trainingGapId)),
      label: "Teach assistant",
    };
  }
  if (input.walletLow) {
    return { href: "/wallet", label: "Add credit" };
  }
  if (input.totalCalls === 0) {
    return { href: businessSettingsHref("test"), label: "Test assistant" };
  }
  return { href: "/calls", label: "Show all calls" };
}

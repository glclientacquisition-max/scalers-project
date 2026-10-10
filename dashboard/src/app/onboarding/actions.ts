"use server";

import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import {
  compilePromptLocally,
  type OnboardingAnswers,
  tenantNeedsOnboarding,
} from "@/lib/onboarding";
import { compileReceptionistPrompt, parseAgentTone } from "@/lib/promptCompiler";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerFacingError } from "@/lib/ownerFacingError";
import { parseVertical } from "@/lib/vertical";
import { parseHandoffMode } from "@/lib/handoffMode";
import { formatLocationsForCompiler } from "@/lib/businessLocations";
import { formatHoursForCompiler } from "@/lib/hoursSchedule";
import { formatProductsForCompiler, normalizeProductCatalog } from "@/lib/productCatalog";
import { formatServicesForCompiler, normalizeServicesCatalog } from "@/lib/servicesCatalog";
import { clampFaq } from "@/lib/faqs";
import { seedOwnerCatchAllTeam } from "@/lib/retailOnboardingPack";
import {
  homeCatalogPasses,
  parseCaptureHours,
  shopCatalogPasses,
} from "@/lib/outcomeGates";
import { upsertTenantFieldMeta } from "@/lib/deskProvenance";
import { updateWithColumnPeel } from "@/lib/peelMissingColumns";
import { validateAgentName } from "@/lib/onboardingDraft";

export type OnboardingState = {
  error?: string;
  step?: number;
};

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const user = await getAuthUser();
  if (!user) {
    if (await isLegacyAuthenticated()) {
      redirect("/admin");
    }
    return { error: "Sign in to finish setup." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account yet." };
  }

  if (!tenantNeedsOnboarding(tenant)) {
    redirect("/home");
  }

  const vertical = parseVertical(formData.get("vertical"));
  const catalogSkipped = String(formData.get("catalog_skipped") || "") === "1";
  const hoursSkipped = String(formData.get("hours_skipped") || "") === "1";
  const hoursRaw = String(formData.get("hours_location") || "").trim();
  const landmark = String(formData.get("landmark") || "").trim();
  const directions = String(formData.get("directions") || "").trim();
  const tone = parseAgentTone(String(formData.get("tone") || ""));
  const handoffMode = parseHandoffMode(formData.get("handoff_mode"));
  const agentNameInput = String(formData.get("agent_name") || "").trim();
  const products = catalogSkipped
    ? []
    : normalizeProductCatalog(safeJson(formData.get("product_catalog"))).map((row) => ({
        ...row,
        source: "owner" as const,
      }));
  const services = catalogSkipped
    ? []
    : normalizeServicesCatalog(safeJson(formData.get("services_catalog")))
        .filter((row) => row.name)
        .map((row) => ({ ...row, source: "owner" as const }));
  const faqs = parseConfirmedFaqs(formData.get("faqs_json"));

  if (!catalogSkipped) {
    if (vertical === "home_services" && !homeCatalogPasses(services)) {
      return {
        error: "Add three services with a price mode and a site visit, or skip.",
        step: 1,
      };
    }
    if (vertical !== "home_services" && !shopCatalogPasses(products)) {
      return { error: "Add priced products, or skip.", step: 1 };
    }
  }
  const schedule = hoursSkipped ? null : parseCaptureHours(hoursRaw);
  if (!hoursSkipped && !schedule) {
    return { error: "Add opening hours, or skip.", step: 2 };
  }
  if (!tone) {
    return { error: "Pick a tone of voice.", step: 3 };
  }

  const businessLocations =
    landmark || directions
      ? [
          {
            label: "Main",
            address: landmark,
            landmark,
            directions,
            coverage_notes: "",
          },
        ]
      : [];
  const locationsText = formatLocationsForCompiler(businessLocations);
  const teamDirectory = seedOwnerCatchAllTeam({
    businessName: tenant.business_name,
    whatsapp: tenant.whatsapp_notification_number,
    email: tenant.alert_email,
  });
  const agentNameCheck = validateAgentName(agentNameInput);
  if (!agentNameCheck.ok) {
    return { error: agentNameCheck.error, step: 3 };
  }
  const agentName = agentNameCheck.name;
  const servicesOffered =
    vertical === "home_services"
      ? formatServicesForCompiler(services, "")
      : formatProductsForCompiler(products);
  const hoursLocation = schedule ? formatHoursForCompiler(schedule) : "";
  const unknownAnswerFallback = "I'll check with the owner.";
  const productsText = formatProductsForCompiler(products);

  const answers: OnboardingAnswers = {
    servicesPricing: servicesOffered,
    hoursLocation,
    tone,
  };

  let { prompt } = await compileReceptionistPrompt({
    businessName: tenant.business_name,
    servicesOffered,
    businessHours: hoursLocation,
    agentTone: tone,
    agentName,
    vertical,
    handoffMode,
    locationsText,
    policiesText: "",
    productsText,
    faqs,
    unknownAnswerFallback,
    teamDirectory,
  });

  if (!prompt || prompt.length < 80) {
    return { error: "Could not build a receptionist prompt. Try again.", step: 3 };
  }

  // Guard: compiled prompt must not look like the signup default.
  if (tenantNeedsOnboarding({ business_name: tenant.business_name, llm_system_prompt: prompt })) {
    prompt = compilePromptLocally(tenant.business_name, answers, {
      agentName,
      faqs,
      unknownAnswerFallback,
      teamDirectory,
      vertical,
      handoffMode,
      locationsText,
      policiesText: "",
      productsText,
    });
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const patch: Record<string, unknown> = {
    services_offered: servicesOffered,
    services_catalog: vertical === "home_services" ? services : [],
    product_catalog: vertical === "home_services" ? [] : products,
    business_hours: hoursLocation,
    agent_tone: tone,
    agent_name: agentName,
    vertical,
    handoff_mode: handoffMode,
    business_locations: businessLocations,
    faqs,
    llm_system_prompt: prompt,
    agent_tools: { escalate: true, end_call: true },
    after_hours_mode: "serve",
    unknown_answer_fallback: unknownAnswerFallback,
  };
  if (schedule) {
    patch.hours_schedule = schedule;
  }
  if (teamDirectory.length) {
    patch.team_directory = teamDirectory;
  }

  // Previously any missing optional column triggered a "core" fallback that silently
  // dropped hours_schedule, agent_name, faqs, catalogs, etc. Peel only what is missing.
  const { error, dropped } = await updateWithColumnPeel(
    patch,
    (next) => workspace.client.from("tenants").update(next).eq("id", tenant.id),
    ["llm_system_prompt"]
  );
  if (error) {
    return {
      error: ownerFacingError(error, "Could not save business details."),
      step: 3,
    };
  }
  if (dropped.length) {
    console.warn("[onboarding] saved without missing columns:", dropped.join(", "));
  }

  await recordCaptureMeta({
    tenantId: tenant.id,
    products,
    services,
    faqs,
    hoursConfirmed: Boolean(schedule),
  });
  redirect("/home");
}

function safeJson(raw: FormDataEntryValue | null): unknown {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

function parseConfirmedFaqs(raw: FormDataEntryValue | null) {
  const parsed = safeJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as { question?: unknown; answer?: unknown };
      const entry = clampFaq({
        question: String(record.question || ""),
        answer: String(record.answer || ""),
        source: "owner",
        status: "confirmed",
      });
      return entry.question && entry.answer ? entry : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

async function recordCaptureMeta(input: {
  tenantId: string;
  products: Array<{ name: string; sku?: string }>;
  services: Array<{ name: string }>;
  faqs: Array<{ question: string }>;
  hoursConfirmed: boolean;
}) {
  const writes: Array<{ fieldPath: string; newValue: string }> = [];
  if (input.hoursConfirmed) {
    writes.push({ fieldPath: "hours.weekly_grid", newValue: "owner" });
  }
  input.products.slice(0, 20).forEach((product, index) => {
    const sku = String(product.sku || "").trim() || String(index + 1);
    writes.push({ fieldPath: `catalog.product.${sku}.name`, newValue: product.name });
  });
  input.services.slice(0, 20).forEach((service, index) => {
    writes.push({
      fieldPath: `catalog.service.${index + 1}.name`,
      newValue: service.name,
    });
  });
  input.faqs.slice(0, 10).forEach((faq, index) => {
    writes.push({ fieldPath: `faqs.${index + 1}`, newValue: faq.question });
  });
  if (!writes.length) return;
  try {
    const first = await upsertTenantFieldMeta({
      tenantId: input.tenantId,
      fieldPath: writes[0].fieldPath,
      source: "owner",
      actor: "desk",
      newValue: writes[0].newValue,
    });
    if (first.error) return;
    await Promise.all(
      writes.slice(1).map((write) =>
        upsertTenantFieldMeta({
          tenantId: input.tenantId,
          fieldPath: write.fieldPath,
          source: "owner",
          actor: "desk",
          newValue: write.newValue,
        })
      )
    );
  } catch {
    /* RPC is not on this database until Platform PR 570 is applied. */
  }
}

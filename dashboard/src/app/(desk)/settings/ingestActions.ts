"use server";

import { formatServiceAreasForCompiler, normalizeServiceAreas, serviceAreasFromCoverage } from "@/lib/serviceAreas";
import { bustTenantCache } from "@/lib/tenantCache";
import { memberDenied } from "@/lib/requireMember";
import { importCatalogueToKb } from "@/lib/kbWrite.server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { compileReceptionistPrompt, parseAgentTone } from "@/lib/promptCompiler";
import { ownerUnknownAnswer, resolveUnknownAnswerSpoken } from "@/lib/unknownAnswerSpoken";
import { generateUnknownAnswerSpoken } from "@/lib/unknownAnswerSpokenModel";
import { withoutUnknownSpokenColumn } from "@/lib/peelMissingColumns";
import { DEFAULT_AGENT_TONE } from "@/lib/onboarding";
import {
  formatServicesForCompiler,
  normalizeServicesCatalog,
} from "@/lib/servicesCatalog";
import { suggestImportedServices } from "@/lib/catalogSuggest";
import {
  formatHoursForCompiler,
  parseHoursSchedule,
  scheduleForForm,
} from "@/lib/hoursSchedule";
import { fetchPublicUrlSafe } from "@/lib/ingest/ssrfFetch";
import {
  htmlToPlainText,
  looksLikeClientRenderedShell,
  normalizePasteText,
} from "@/lib/ingest/sanitize";
import {
  extractKnowledgeFromText,
  isProseServiceName,
  mergeIngestDraft,
  parseIngestIndexes,
  type IngestDraft,
} from "@/lib/ingest/extract";
import type { FaqEntry, TeamDirectoryEntry } from "@/lib/supabase";
import { normalizeTeamDirectory } from "@/lib/teamNotify";
import { parseAgentTools } from "@/lib/agentTools";
import { assignServiceIds } from "@/lib/serviceIds";
import { parseVertical } from "@/lib/vertical";
import { parseHandoffMode } from "@/lib/handoffMode";
import {
  formatLocationsForCompiler,
  normalizeBusinessLocations,
} from "@/lib/businessLocations";
import {
  formatPoliciesForCompiler,
  normalizeBusinessPolicies,
} from "@/lib/businessPolicies";

export type IngestExtractState = {
  error?: string;
  ok?: boolean;
  draft?: IngestDraft;
  extractSource?: "gemini" | "local";
  message?: string;
};

export type IngestApplyState = {
  error?: string;
  ok?: boolean;
  message?: string;
  source?: "gemini" | "local";
};

const extractHits = new Map<string, number[]>();

function rateLimitExtract(tenantId: string): string | null {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 8;
  const prev = (extractHits.get(tenantId) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    return "You've scanned a few times recently. Wait a few minutes, or paste a smaller section.";
  }
  prev.push(now);
  extractHits.set(tenantId, prev);
  return null;
}

function normalizeTeam(raw: unknown): TeamDirectoryEntry[] {
  return normalizeTeamDirectory(raw, { requireName: true, infer: false });
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

export async function extractKnowledgeAction(
  _prev: IngestExtractState,
  formData: FormData
): Promise<IngestExtractState> {
  const denied = await memberDenied("settings.edit");
  if (denied) return denied;
  if (!(await isAuthenticated())) {
    return { error: "Sign in to import knowledge." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const tenantId = String(formData.get("tenant_id") || "").trim();
  if (!tenantId || tenantId !== tenant.id) return { error: "Forbidden." };

  const limited = rateLimitExtract(tenant.id);
  if (limited) return { error: limited };

  const mode = String(formData.get("source_mode") || "paste").trim().toLowerCase();
  try {
    let sourceText = "";
    let sourceLabel = "pasted text";

    if (mode === "url") {
      const url = String(formData.get("url") || "").trim();
      const fetched = await fetchPublicUrlSafe(url);
      const shell = looksLikeClientRenderedShell(fetched.text);
      sourceText = htmlToPlainText(fetched.text);
      sourceLabel = fetched.finalUrl;

      // Client-rendered sites (empty #root/#app) rarely expose a menu in HTML.
      // Fail fast instead of waiting on AI over a page summary.
      if (shell) {
        return {
          error:
            "This website builds its menu in the browser, so the link alone isn’t enough. Switch to Paste text and drop in your services or FAQs. That usually finishes in a few seconds.",
        };
      }
      if (sourceText.length < 40) {
        return {
          error:
            "We opened the page but found almost no text. Try pasting the menu or FAQ section instead.",
        };
      }
    } else {
      sourceText = normalizePasteText(String(formData.get("paste") || ""));
      sourceLabel = "pasted text";
      if (sourceText.length < 12) {
        return { error: "Paste your menu, price list, or FAQs first." };
      }
    }

    const { draft, source } = await extractKnowledgeFromText({
      sourceText,
      sourceLabel,
      businessName: tenant.business_name,
    });

    const hasStructured =
      Boolean(draft.locations?.length) ||
      Boolean(draft.hoursNotes) ||
      Boolean(draft.hoursSchedule) ||
      Boolean(
        draft.policies &&
          Object.values(draft.policies).some((v) => String(v || "").trim())
      ) ||
      Boolean(draft.vertical) ||
      Boolean(draft.contactPhone);

    if (
      !draft.services.length &&
      !draft.faqs.length &&
      !draft.team.length &&
      !hasStructured
    ) {
      return {
        error:
          "We couldn't find clear services, FAQs, or business details in that. Try a cleaner paste (menu lines, Q/A, or a short business overview).",
      };
    }

    const bits = [];
    if (draft.services.length) bits.push(`${draft.services.length} service${draft.services.length === 1 ? "" : "s"}`);
    if (draft.faqs.length) bits.push(`${draft.faqs.length} FAQ${draft.faqs.length === 1 ? "" : "s"}`);
    if (draft.team.length) bits.push(`${draft.team.length} teammate${draft.team.length === 1 ? "" : "s"}`);
    if (draft.locations?.length) bits.push("location");
    if (draft.hoursNotes || draft.hoursSchedule) bits.push("hours");
    if (
      draft.policies &&
      Object.values(draft.policies).some((v) => String(v || "").trim())
    ) {
      bits.push("policies");
    }

    return {
      ok: true,
      draft,
      extractSource: source,
      message: `We found ${bits.join(" and ")}. Tick what looks right, then add them.`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not scan that source.",
    };
  }
}

export async function applyIngestAction(
  _prev: IngestApplyState,
  formData: FormData
): Promise<IngestApplyState> {
  const denied = await memberDenied("settings.edit");
  if (denied) return denied;
  if (!(await isAuthenticated())) {
    return { error: "Sign in to save." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const tenantId = String(formData.get("tenant_id") || "").trim();
  if (!tenantId || tenantId !== tenant.id) return { error: "Forbidden." };

  let draft: IngestDraft;
  try {
    draft = JSON.parse(String(formData.get("draft_json") || "{}")) as IngestDraft;
  } catch {
    return { error: "Draft expired. Scan again." };
  }
  if (!draft || !Array.isArray(draft.services)) {
    return { error: "Draft expired. Scan again." };
  }

  const mode =
    String(formData.get("merge_mode") || "merge").trim() === "replace_services_faqs"
      ? "replace_services_faqs"
      : "merge";
  // Import never sets the "when unsure" line, team (transfer numbers), business type, name or the alert number:
  // those live on their own screens. Older clients that still post the switches are ignored.
  const includeUnknown = false;
  const includeLocations =
    String(formData.get("include_locations") || "") === "1";
  const includeHours = String(formData.get("include_hours") || "") === "1";
  const includePolicies =
    String(formData.get("include_policies") || "") === "1";
  const includeVertical = false;
  const includeContactPhone = false;
  const renameBusiness = false;

  const selectedServiceIndexes = parseIngestIndexes(formData.get("selected_services"));
  const selectedFaqIndexes = parseIngestIndexes(formData.get("selected_faqs"));
  const selectedTeamIndexes: number[] = [];

  const existingServices = normalizeServicesCatalog(tenant.services_catalog).filter(
    (s) => s.name && !isProseServiceName(s.name)
  );
  const existingFaqs = normalizeFaqs(tenant.faqs);
  const existingTeam = normalizeTeam(tenant.team_directory);
  const existingUnknown = String(tenant.unknown_answer_fallback || "").trim();

  const merged = mergeIngestDraft({
    existingServices,
    existingFaqs,
    existingTeam,
    existingUnknown,
    draft: {
      // Keep the visible order. Prose is dropped after the index lookup.
      services: Array.isArray(draft.services) ? draft.services : [],
      faqs: Array.isArray(draft.faqs) ? draft.faqs : [],
      team: Array.isArray(draft.team) ? draft.team : [],
      unknownAnswerFallback: String(draft.unknownAnswerFallback || ""),
      sourceLabel: String(draft.sourceLabel || "import"),
    },
    selectedServiceIndexes,
    selectedFaqIndexes,
    selectedTeamIndexes,
    includeUnknown,
    mode,
  });

  if (merged.touched.services) {
    merged.services = suggestImportedServices(
      merged.services.filter((s) => s.name && !isProseServiceName(s.name)),
      parseVertical(tenant.vertical)
    );
  }

  const draftLocations = includeLocations
    ? normalizeBusinessLocations(draft.locations)
    : [];
  const draftPolicies = includePolicies
    ? normalizeBusinessPolicies(draft.policies || {})
    : normalizeBusinessPolicies({});
  const policiesFilled = Object.values(draftPolicies).some((v) =>
    String(v || "").trim()
  );
  const draftHoursNotes = includeHours
    ? String(draft.hoursNotes || "").trim()
    : "";
  const parsedDraftSchedule = includeHours
    ? parseHoursSchedule(draft.hoursSchedule || null)
    : null;
  const draftVertical =
    includeVertical && draft.vertical ? parseVertical(draft.vertical) : null;
  const draftPhone = includeContactPhone
    ? String(draft.contactPhone || "").trim()
    : "";
  const nameSuggestion = renameBusiness
    ? String(draft.businessNameSuggestion || "").trim()
    : "";

  const hasStructuredApply =
    draftLocations.length > 0 ||
    Boolean(draftHoursNotes) ||
    Boolean(parsedDraftSchedule) ||
    policiesFilled ||
    Boolean(draftVertical) ||
    Boolean(draftPhone) ||
    Boolean(nameSuggestion);

  if (
    !merged.touched.services &&
    !merged.touched.faqs &&
    !merged.touched.team &&
    !hasStructuredApply &&
    !includeUnknown
  ) {
    return {
      error:
        "No usable catalog items, FAQs, or business details in that selection. For long documents, paste a short overview (or menu / Q&A), then try again.",
    };
  }

  const agentTone =
    parseAgentTone(String(tenant.agent_tone || "")) || DEFAULT_AGENT_TONE;

  const nextLocations =
    draftLocations.length > 0
      ? draftLocations
      : normalizeBusinessLocations(tenant.business_locations);

  const locFallback =
    draftLocations[0]?.address ||
    nextLocations[0]?.address ||
    String(tenant.business_hours || "").trim() ||
    "";

  let nextSchedule = scheduleForForm(tenant.hours_schedule, locFallback);
  if (parsedDraftSchedule) {
    nextSchedule = {
      ...parsedDraftSchedule,
      location: parsedDraftSchedule.location || locFallback,
    };
  }

  const compiledHours =
    formatHoursForCompiler(nextSchedule) ||
    String(tenant.business_hours || "").trim();
  const businessHours = includeHours
    ? draftHoursNotes || compiledHours || "Hours not set yet. Confirm with the team."
    : compiledHours;

  const existingPolicies = normalizeBusinessPolicies(tenant.business_policies);
  const nextPolicies = policiesFilled
    ? {
        ...existingPolicies,
        payment: draftPolicies.payment || existingPolicies.payment,
        returns: draftPolicies.returns || existingPolicies.returns,
        delivery: draftPolicies.delivery || existingPolicies.delivery,
        deposit: draftPolicies.deposit || existingPolicies.deposit,
        cancellation:
          draftPolicies.cancellation || existingPolicies.cancellation,
        warranty: draftPolicies.warranty || existingPolicies.warranty,
        other: draftPolicies.other || existingPolicies.other,
      }
    : existingPolicies;

  const servicesOffered = formatServicesForCompiler(merged.services, "");
  const agentName = String(tenant.agent_name || "Receptionist").trim() || "Receptionist";
  const vertical = draftVertical || parseVertical(tenant.vertical);
  const handoffMode = parseHandoffMode(tenant.handoff_mode);
  const areas =
    tenant.service_areas && typeof tenant.service_areas === "object"
      ? normalizeServiceAreas(tenant.service_areas, vertical)
      : serviceAreasFromCoverage(nextPolicies.coverage_areas, vertical);
  const locationsText = [formatLocationsForCompiler(nextLocations, { noPremises: areas?.no_premises }), formatServiceAreasForCompiler(areas)]
    .filter(Boolean)
    .join("\n\n");
  const policiesText = formatPoliciesForCompiler(nextPolicies);
  const businessName = nameSuggestion || tenant.business_name;

  const agentTools = parseAgentTools(tenant.agent_tools);
  const unknownLine = ownerUnknownAnswer(merged.unknownAnswerFallback);
  const spokenPromise = resolveUnknownAnswerSpoken({
    fallback: unknownLine,
    stored: tenant.unknown_answer_spoken,
    generate: generateUnknownAnswerSpoken,
  });
  const [{ prompt, source }, unknownAnswerSpoken] = await Promise.all([
    compileReceptionistPrompt({
    businessName,
    servicesOffered,
    businessHours,
    agentTone,
    agentName,
    teamDirectory: merged.team,
    faqs: merged.faqs,
    unknownAnswerFallback: unknownLine,
    escalateEnabled: agentTools.escalate,
    vertical,
    handoffMode,
    locationsText,
    policiesText,
  }),
    spokenPromise,
  ]);

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const patch: Record<string, unknown> = {
    unknown_answer_fallback: unknownLine || null,
    unknown_answer_spoken: unknownAnswerSpoken,
    llm_system_prompt: prompt,
  };
  // Imported services go into kb_items (add-only, after the update below): an item the owner already has keeps its
  // state and price; nothing is hidden. The KB mirror then rewrites services_catalog + services_offered.
  const importedServices = merged.touched.services
    ? assignServiceIds(merged.services, normalizeServicesCatalog(tenant.services_catalog))
    : null;
  if (merged.touched.faqs) {
    patch.faqs = merged.faqs;
  }
  if (merged.touched.team) {
    patch.team_directory = merged.team;
  }
  // Persist tone if it was missing so future imports/saves don't block.
  if (!tenant.agent_tone) {
    patch.agent_tone = agentTone;
  }
  if (draftLocations.length > 0) {
    patch.business_locations = nextLocations;
  }
  if (includeHours) {
    patch.business_hours = businessHours;
    if (parsedDraftSchedule) {
      patch.hours_schedule = nextSchedule;
    }
  }
  if (policiesFilled) {
    patch.business_policies = nextPolicies;
  }

  let { error } = await workspace.client
    .from("tenants")
    .update(patch)
    .eq("id", tenant.id);
  if (error) {
    const peeled = withoutUnknownSpokenColumn(error.message, patch);
    if (peeled) {
      ({ error } = await workspace.client.from("tenants").update(peeled).eq("id", tenant.id));
    }
  }
  bustTenantCache(tenant.id);

  if (error) {
    return ownerSaveFailed("ingest", error.message);
  }
  // Owner ticked these rows: re-stamp what was added (restamp), and report the KB's own counts.
  const kb = importedServices
    ? await importCatalogueToKb(tenant.id, { services_catalog: importedServices }, {
        legacyServicesOffered: servicesOffered,
        legacyColumns: { services_catalog: importedServices },
        by: "import",
        restamp: true,
      })
    : null;

  revalidatePath("/settings");

  const parts = [];
  const addedServices = kb && kb.ok ? kb.added : merged.added.services;
  if (addedServices) {
    parts.push(`${addedServices} service${addedServices === 1 ? "" : "s"}`);
  }
  if (merged.added.faqs) {
    parts.push(`${merged.added.faqs} FAQ${merged.added.faqs === 1 ? "" : "s"}`);
  }
  if (merged.added.team) {
    parts.push(
      `${merged.added.team} teammate${merged.added.team === 1 ? "" : "s"}`
    );
  }
  if (draftLocations.length) parts.push("location");
  if (includeHours && (draftHoursNotes || draft.hoursSchedule)) parts.push("hours");
  if (policiesFilled) parts.push("policies");
  if (draftVertical) parts.push(`vertical (${draftVertical})`);
  if (nameSuggestion) parts.push("business name");

  const capNote =
    merged.skippedFaqCap && merged.skippedFaqCap > 0
      ? ` ${merged.skippedFaqCap} FAQ${
          merged.skippedFaqCap === 1 ? "" : "s"
        } could not fit (max 25).`
      : "";

  const kept = kb && kb.ok && kb.kept ? ` Kept ${kb.kept} you already had.` : "";
  if (mode === "replace_services_faqs" || parts.length > 0) {
    return {
      ok: true,
      source,
      message: `${parts.length ? `Added ${parts.join(", ")}.` : "Saved."}${kept}${capNote}`,
    };
  }

  return {
    ok: true,
    source,
    message: capNote ? `Nothing new fit.${capNote}` : `Nothing new to add.${kept || " Those items were already on file."}`,
  };
}

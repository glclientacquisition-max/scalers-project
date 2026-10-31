"use server";

import { bustTenantCache } from "@/lib/tenantCache";
import { requestSpokenCatalogueCompile } from "@/lib/spokenCatalogueOnSave";
import { importCatalogueToKb } from "@/lib/kbWrite.server";
import { PRODUCT_ID_PREFIX, parseBaseline, settleCatalogPrices } from "@/lib/catalogPricing";
import { readCatalogFresh } from "@/lib/catalogFresh";
import { normalizePhone } from "@/lib/setupFlow";
import { memberDenied } from "@/lib/requireMember";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAuthUser, isAuthenticated } from "@/lib/auth";
import {
  parseAgentTone,
  compileReceptionistPrompt,
  parseTeamDirectoryField,
  parseFaqsField,
} from "@/lib/promptCompiler";
import {
  formatHoursForCompiler,
  parseHoursSchedule,
} from "@/lib/hoursSchedule";
import { parseAfterHoursMode } from "@/lib/afterHours";
import {
  extractServicesNotes,
  formatServicesForCompiler,
  normalizeServicesCatalog,
  parseServicesCatalogField,
} from "@/lib/servicesCatalog";
import {
  formatProductsForCompiler,
  normalizeProductCatalog,
  parseProductCatalogField,
  PRODUCT_CATALOG_MAX,
} from "@/lib/productCatalog";
import {
  formatSocialHandlesForCompiler,
  parseSocialHandlesField,
} from "@/lib/socialHandles";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { parseAgentTools } from "@/lib/agentTools";
import { DEFAULT_AGENT_TONE } from "@/lib/onboarding";
import { parseVertical } from "@/lib/vertical";
import { businessTypeForVertical } from "@/lib/identityCategory";
import { parseHandoffMode } from "@/lib/handoffMode";
import { parseSonioxVoiceId, parseSonioxVoiceLabel } from "@/lib/sonioxVoiceCatalog";
import {
  formatLocationsForCompiler,
  parseBusinessLocationsField,
} from "@/lib/businessLocations";
import {
  formatPoliciesForCompiler,
  parseBusinessPoliciesField,
  applyStructuredPolicies,
  businessPoliciesForStorage,
} from "@/lib/businessPolicies";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import {
  ownerAttestFields,
  ownerConfirmPlan,
  readSavedFactRow,
} from "@/lib/ownerAttestFields";
import { fieldPathsAttestedOnSettingsSave } from "@/lib/fieldPathsFromSettingsSave";
import { cleanFieldPaths } from "@/lib/fieldPathRegistry";
import { factSaveIsConfirm } from "@/lib/deskFeatureFlags";
import {
  greetingLanguagePatch,
  greetingTextClearPatch,
  saveMatchedNoRows,
  settingsFieldFromScope,
  settingsScopeValidationError,
} from "@/lib/settingsSaveScope";
import { deniedMessage } from "@/lib/permissions";
import { ownerUnknownAnswer, planUnknownAnswerSave } from "@/lib/unknownAnswerSpoken";
import { generateUnknownAnswerSpoken } from "@/lib/unknownAnswerSpokenModel";
import { withoutUnknownSpokenColumn } from "@/lib/peelMissingColumns";
import { factHashModeFromEnv, loadCompileProvenance } from "@/lib/tenantFieldProvenance";
import { overlayFieldMeta, planFactConfirm } from "@/lib/factConfirm";
import { normalizeFactRow } from "@/lib/factRowNormalize";
import { assignServiceIds } from "@/lib/serviceIds";
import { ownerAlertPhone, validateTeamSave, type TeamRowInput } from "@/lib/teamValidation";
import {
  catalogPriceFieldKey,
  catalogSaveError,
  omitUnsavedPrices,
  priceIssueSummary,
} from "@/lib/catalogValidation";
import { validatePublicContacts } from "@/lib/contactValidation";
import { faqsLengthError, policiesLengthError } from "@/lib/lengthLimits";
import { POLICY_FIELDS } from "@/lib/businessPolicies";
import {
  coverageIdsFrom,
  coverageOutsideFrom,
  parseServiceAreasField,
  serviceAreasWithNoPremises,
  storedNoPremises,
  validateServiceArea,
} from "@/lib/serviceAreas";

function safeJsonRows(raw: FormDataEntryValue | null): TeamRowInput[] {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r === "object") : [];
  } catch {
    return [];
  }
}

export type SettingsCompileState = {
  /** Field errors from typed payments and policy rules, keyed like the form ids. */
  fields?: Record<string, string>;
  error?: string;
  ok?: boolean;
  source?: "gemini" | "local";
  /** Present when this save owns the unsure line. Null clears the spoken lines. */
  unknownAnswerSpoken?: { en: string; sw: string; source: string } | null;
  /** Client only: the response was lost (connection dropped). The save may have landed. */
  networkError?: boolean;
};

/** Background model rewrite of the prompt; the settings page allows 60 s in total. */
const PROMPT_UPGRADE_BUDGET_MS = 25_000;

export async function saveAndCompileSettings(
  _prev: SettingsCompileState,
  formData: FormData
): Promise<SettingsCompileState> {
  const t0 = Date.now();
  // Independent request-scoped checks: run together, not one after another.
  const [denied, signedIn, tenant] = await Promise.all([
    memberDenied("settings.edit"),
    isAuthenticated(),
    getCurrentTenant(),
  ]);
  const tAuth = Date.now();
  if (denied) return denied;
  if (!signedIn) {
    return { error: "Sign in to save settings." };
  }

  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const scope = String(formData.get("settings_scope") || "");
  const pick = <T,>(field: string, fromForm: T, stored: T) =>
    settingsFieldFromScope(scope, field, fromForm, stored);

  const businessName = pick(
    "businessName",
    String(formData.get("business_name") || "").trim(),
    String(tenant.business_name || "").trim()
  );
  const servicesNotes = pick(
    "servicesNotes",
    String(formData.get("services_notes") || "").trim(),
    extractServicesNotes(tenant.services_offered || "")
  );
  const ownsServices = settingsFieldFromScope(scope, "servicesCatalog", true, false);
  const ownsProducts = settingsFieldFromScope(scope, "productCatalog", true, false);
  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }
  // Catalogue saves settle prices against the row as stored now (not the 15 s cached copy):
  // a price confirmed a moment ago must not be undone by a form that loaded before it.
  const fresh =
    ownsServices || ownsProducts ? await readCatalogFresh(workspace.client, tenant.id) : null;
  const storedServices = normalizeServicesCatalog(fresh?.services_catalog ?? tenant.services_catalog).filter((row) => row.name);
  const pickedServices = pick(
    "servicesCatalog",
    parseServicesCatalogField(formData.get("services_catalog")),
    storedServices
  );
  const baseline = parseBaseline(formData.get("catalog_baseline"));
  const storedProducts = normalizeProductCatalog(fresh?.product_catalog ?? tenant.product_catalog).filter((row) => row.name);
  const pickedProducts = pick(
    "productCatalog",
    parseProductCatalogField(formData.get("product_catalog")),
    storedProducts
  );
  // One bad price must not throw away the rest of the paste. Ask wording
  // ("price depends on size") is kept. A row that still is not a price is
  // reported on its own and left out of this save.
  const serviceSplit = ownsServices
    ? omitUnsavedPrices(pickedServices, "price_range", storedServices)
    : { rows: pickedServices, issues: [] };
  const productSplit = ownsProducts
    ? omitUnsavedPrices(pickedProducts, "price", storedProducts)
    : { rows: pickedProducts, issues: [] };
  const priceIssues = [...serviceSplit.issues, ...productSplit.issues];
  const priceFields = Object.fromEntries(
    priceIssues.map((issue) => [catalogPriceFieldKey(issue.name), issue.message])
  );
  const ownedRowsEmpty =
    (!ownsServices || serviceSplit.rows.length === 0) &&
    (!ownsProducts || productSplit.rows.length === 0);
  if (priceIssues.length && ownedRowsEmpty && (ownsServices || ownsProducts)) {
    return { error: priceIssueSummary(priceIssues, false), fields: priceFields };
  }
  // Catalogue saves give every row a stable id; other panels keep the stored rows as-is.
  // The browser's typed price is never trusted: unchanged text keeps the stored price (and its
  // confirmation), edited text is read now (lib/catalogPricing.ts).
  const servicesCatalog = ownsServices
    ? assignServiceIds(
        settleCatalogPrices(serviceSplit.rows, storedServices, "service", { baseline, unitFallback: "job" }),
        storedServices
      )
    : pickedServices;
  const productCatalog = ownsProducts
    ? assignServiceIds(
        settleCatalogPrices(productSplit.rows, storedProducts, "product", { baseline }),
        storedProducts,
        PRODUCT_ID_PREFIX
      )
    : pickedProducts;
  if (
    settingsFieldFromScope(scope, "productCatalog", true, false) ||
    settingsFieldFromScope(scope, "servicesCatalog", true, false)
  ) {
    const catalogError = catalogSaveError({
      products: settingsFieldFromScope(scope, "productCatalog", true, false) ? productCatalog : [],
      services: settingsFieldFromScope(scope, "servicesCatalog", true, false) ? servicesCatalog : [],
    });
    if (catalogError) return { error: catalogError, fields: priceFields };
  }
  let socialHandles = pick(
    "socialHandles",
    parseSocialHandlesField(formData.get("social_handles")),
    parseSocialHandlesField(JSON.stringify(tenant.social_handles || {}))
  );
  if (settingsFieldFromScope(scope, "socialHandles", true, false)) {
    const contacts = validatePublicContacts(socialHandles);
    if (!contacts.ok) return { error: contacts.error };
    socialHandles = contacts.handles;
  }
  const servicesBlock = formatServicesForCompiler(servicesCatalog, servicesNotes);
  const productsBlock = formatProductsForCompiler(productCatalog);
  const socialBlock = formatSocialHandlesForCompiler(socialHandles);
  const compiledServices = [
    servicesBlock,
    productsBlock,
    socialBlock ? `Social & web:\n${socialBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // A Hours save ships empty catalog fields. Keep the stored offer text when
  // the compiler string is empty so a legacy blob is not replaced by that form.
  const servicesOffered =
    compiledServices ||
    pick(
      "servicesCatalog",
      String(formData.get("services_offered") || "").trim(),
      String(tenant.services_offered || "").trim()
    );
  const clipOwnerLine = (raw: string, max: number) =>
    raw.replace(/\s+/g, " ").trim().slice(0, max).trim();

  const spokenName = pick(
    "spokenName",
    clipOwnerLine(String(formData.get("spoken_name") || ""), 40),
    clipOwnerLine(String(tenant.spoken_name || ""), 40)
  );
  const greetingInvite = pick(
    "greetingInvite",
    clipOwnerLine(String(formData.get("greeting_invite") || ""), 80),
    clipOwnerLine(String(tenant.greeting_invite || ""), 80)
  );
  const agentName = pick(
    "agentName",
    String(formData.get("agent_name") || "").trim() || "Receptionist",
    String(tenant.agent_name || "").trim() || "Receptionist"
  );
  const agentTone = pick(
    "agentTone",
    parseAgentTone(String(formData.get("agent_tone") || "")),
    parseAgentTone(String(tenant.agent_tone || ""))
  );
  const unknownAnswerFallback = pick(
    "unknownAnswerFallback",
    ownerUnknownAnswer(formData.get("unknown_answer_fallback")),
    ownerUnknownAnswer(tenant.unknown_answer_fallback)
  );
  let teamDirectory = pick(
    "teamDirectory",
    parseTeamDirectoryField(formData.get("team_directory")),
    parseTeamDirectoryField(JSON.stringify(tenant.team_directory || []))
  );
  if (settingsFieldFromScope(scope, "teamDirectory", true, false)) {
    // Validate the raw rows so bad email/phone, nameless rows, duplicates, owner
    // removal return a visible error (not a silent drop). Team contacts are not
    // paid seats (owner decision); login-member seats are tracked elsewhere.
    const team = validateTeamSave({
      submitted: safeJsonRows(formData.get("team_directory")),
      stored: Array.isArray(tenant.team_directory) ? (tenant.team_directory as TeamRowInput[]) : [],
      ownerPhone: ownerAlertPhone(tenant),
    });
    if (!team.ok) return { error: team.error };
    // Store E.164 (+2547...) so calls, contacts and alerts match one format.
    teamDirectory = parseTeamDirectoryField(
      JSON.stringify(team.rows.map((r) => ({ ...r, phone: r.phone ? normalizePhone(r.phone) || r.phone : r.phone })))
    );
  }
  const faqs = pick(
    "faqs",
    parseFaqsField(formData.get("faqs")),
    parseFaqsField(JSON.stringify(tenant.faqs || []))
  );
  const agentTools = pick(
    "agentTools",
    parseAgentTools({
      escalate: String(formData.get("tool_escalate") || "") !== "0",
      end_call: String(formData.get("tool_end_call") || "") !== "0",
    }),
    parseAgentTools(tenant.agent_tools)
  );

  const hoursSchedule = pick(
    "hoursSchedule",
    parseHoursSchedule(formData.get("hours_schedule")),
    parseHoursSchedule(tenant.hours_schedule)
  );
  const locationNotes = pick(
    "locationNotes",
    String(formData.get("location_notes") || "").trim(),
    String(parseHoursSchedule(tenant.hours_schedule)?.location || "").trim()
  );
  const afterHoursMode = pick(
    "afterHoursMode",
    parseAfterHoursMode(formData.get("after_hours_mode")),
    parseAfterHoursMode(tenant.after_hours_mode)
  );
  const vertical = pick(
    "vertical",
    parseVertical(formData.get("vertical")),
    parseVertical(tenant.vertical)
  );
  const handoffMode = pick(
    "handoffMode",
    parseHandoffMode(formData.get("handoff_mode")),
    parseHandoffMode(tenant.handoff_mode)
  );
  const sonioxVoiceId = pick(
    "sonioxVoiceId",
    await parseSonioxVoiceId(formData.get("soniox_voice_id")),
    await parseSonioxVoiceId(tenant.soniox_voice_id)
  );
  const sonioxVoiceLabel = pick(
    "sonioxVoiceLabel",
    parseSonioxVoiceLabel(formData.get("soniox_voice_label")),
    parseSonioxVoiceLabel(tenant.soniox_voice_label)
  );
  const businessLocations = pick(
    "businessLocations",
    parseBusinessLocationsField(formData.get("business_locations")),
    parseBusinessLocationsField(JSON.stringify(tenant.business_locations || []))
  );
  const policiesFromForm = settingsFieldFromScope(scope, "businessPolicies", true, false);
  let businessPolicies = pick(
    "businessPolicies",
    parseBusinessPoliciesField(formData.get("business_policies")),
    parseBusinessPoliciesField(JSON.stringify(tenant.business_policies || {}))
  );
  if (policiesFromForm) {
    // Typed payments and rules: validate, then generate the spoken text from them.
    const structured = applyStructuredPolicies(businessPolicies);
    if (!structured.ok) return { error: structured.error, fields: structured.fields };
    businessPolicies = structured.policies;
  }
  // Service areas live on Settings › Service areas (tenant_area_picks). Locations is branches only.
  const ownsAreas = settingsFieldFromScope(scope, "serviceAreas", true, false);
  const formAreas = ownsAreas ? parseServiceAreasField(formData.get("service_areas"), vertical) : null;
  if (formAreas) {
    for (const area of formAreas.areas) {
      const fields = validateServiceArea(area);
      const first = Object.values(fields)[0];
      if (first) return { error: first };
    }
    businessPolicies = {
      ...businessPolicies,
      coverage_areas: coverageIdsFrom(formAreas),
      coverage_outside: coverageOutsideFrom(formAreas),
    };
  }
  // Locations owns the "no premises" switch. Only that key of service_areas changes.
  const storedPremisesFlag = storedNoPremises(tenant.service_areas);
  const premisesField = formData.get("no_premises");
  const noPremises =
    settingsFieldFromScope(scope, "noPremises", true, false) && premisesField != null
      ? String(premisesField) === "1"
      : storedPremisesFlag;
  if (formAreas) formAreas.no_premises = noPremises;
  const premisesAreas =
    !formAreas && noPremises !== storedPremisesFlag
      ? serviceAreasWithNoPremises(tenant.service_areas, tenant.business_policies?.coverage_areas, vertical, noPremises)
      : null;
  const ttsLexicon = lexiconForStorage(
    pick(
      "ttsLexicon",
      parseTtsLexicon(formData.get("tts_lexicon")),
      parseTtsLexicon(tenant.tts_lexicon)
    )
  );
  const storedHours = parseHoursSchedule(tenant.hours_schedule);
  const ownsLocationLine = settingsFieldFromScope(scope, "locationNotes", true, false);
  const scheduleForSave = hoursSchedule
    ? {
        ...hoursSchedule,
        location: ownsLocationLine
          ? locationNotes
          : String(storedHours?.location || "").trim(),
      }
    : null;
  const compiledHours = formatHoursForCompiler(scheduleForSave);
  const businessHours =
    compiledHours ||
    pick(
      "hoursSchedule",
      String(formData.get("business_hours") || "").trim(),
      String(tenant.business_hours || "").trim()
    );
  const locationsText = formatLocationsForCompiler(businessLocations, { noPremises });
  const policiesText = formatPoliciesForCompiler(businessPolicies);

  const scopeError = settingsScopeValidationError(scope, {
    businessName,
    agentName,
    servicesCatalogCount: servicesCatalog.length,
    productCatalogCount: productCatalog.length,
    servicesOfferedLength: servicesOffered.length,
    productCatalogMax: PRODUCT_CATALOG_MAX,
    hasSchedule: Boolean(scheduleForSave),
    businessHoursLength: businessHours.length,
    hasTone: Boolean(agentTone),
    teamCount: teamDirectory.length,
    faqCount: faqs.length,
    submittedVoiceId: String(formData.get("soniox_voice_id") || "").trim(),
    resolvedVoiceId: sonioxVoiceId,
    voiceLabel: String(formData.get("soniox_voice_label") || "").trim(),
  });
  if (scopeError) return { error: scopeError };
  if (settingsFieldFromScope(scope, "faqs", true, false)) {
    const faqLen = faqsLengthError(formData.get("faqs"));
    if (faqLen) return { error: faqLen };
  }
  if (settingsFieldFromScope(scope, "businessPolicies", true, false)) {
    const policyLen = policiesLengthError(
      formData.get("business_policies"),
      Object.fromEntries(POLICY_FIELDS.map((f) => [f.id, f.label]))
    );
    if (policyLen) return { error: policyLen };
  }

  const ownerPathsFromForm = (() => {
    try {
      const parsed = JSON.parse(String(formData.get("owner_field_paths") || "[]"));
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  })();

  const patch: Record<string, unknown> = {
    business_name: businessName,
    // kb_items is the source of truth (28 Oct). services_offered is never written from this form (the KB mirror
    // derives it), and the old catalogue columns are written only by a save that owns them (no stale copy back).
    ...(ownsServices ? { services_catalog: servicesCatalog } : {}),
    ...(ownsProducts ? { product_catalog: productCatalog } : {}),
    social_handles: socialHandles,
    business_hours: businessHours,
    hours_schedule: scheduleForSave,
    after_hours_mode: afterHoursMode,
    agent_name: agentName,
    spoken_name: spokenName || null,
    greeting_invite: greetingInvite || null,
    agent_tone: agentTone,
    team_directory: teamDirectory,
    faqs,
    unknown_answer_fallback: unknownAnswerFallback || null,
    agent_tools: agentTools,
    vertical,
    business_type: businessTypeForVertical(vertical),
    handoff_mode: handoffMode,
    soniox_voice_id: sonioxVoiceId,
    soniox_voice_label: sonioxVoiceLabel,
    business_locations: businessLocations,
    business_policies: businessPoliciesForStorage(businessPolicies),
    ...(formAreas ? { service_areas: formAreas } : premisesAreas ? { service_areas: premisesAreas } : {}),
    tts_lexicon: ttsLexicon,
    // How you answer owns the business's default greeting language; no other save writes it.
    ...greetingLanguagePatch(scope, formData.get("greeting_language")),
    // Go back to automatic clears the owner's full greeting (column grant, owner RLS). Not a compile input.
    ...greetingTextClearPatch(scope, formData.get("greeting_text_clear")),
  };

  // FACT_HASH_MODE: confirm only what changed (plus "Looks right" paths). Both
  // sides go through normalizeFactRow before the diff, so a raw seed or import
  // row never looks changed against its parsed copy. The compile below already
  // sees that pending confirm; the write hashes the stored row as saved.
  const hashMode = factHashModeFromEnv();
  const saveIsConfirm = factSaveIsConfirm();
  const attestPathsPre = fieldPathsAttestedOnSettingsSave({
    scope,
    businessName,
    vertical,
    spokenName,
    agentName,
    agentTone,
    agentTools,
    hasStructuredHours: Boolean(scheduleForSave),
    businessHoursLength: businessHours.length,
    businessLocationsCount: businessLocations.length,
    businessPolicies,
    productCatalog,
    servicesCatalog,
    faqs,
    hasSocialHandles:
      Array.isArray(socialHandles?.channels) &&
      socialHandles.channels.some((row) => row && String(row.value || "").trim()),
    lineNumber: String(tenant.sautikit_virtual_number || "").trim(),
    serviceAreas: formAreas ?? null,
  });
  const explicitPaths = cleanFieldPaths(
    saveIsConfirm ? [...ownerPathsFromForm, ...attestPathsPre] : ownerPathsFromForm
  );
  const tPrep = Date.now();
  const [savedBefore, provenance] = await Promise.all([
    hashMode ? readSavedFactRow(workspace.client, tenant.id) : Promise.resolve(null),
    loadCompileProvenance(tenant.id),
  ]);
  const storedFactRow: Record<string, unknown> = savedBefore ?? { ...tenant };
  const tReads = Date.now();
  const compileFieldMeta = hashMode
    ? overlayFieldMeta(
        provenance.fieldMeta,
        planFactConfirm({
          scope,
          before: storedFactRow,
          after: { ...storedFactRow, ...patch },
          explicitPaths,
          normalize: normalizeFactRow,
          saveIsConfirm,
        })
      )
    : provenance.fieldMeta;
  const ownsUnknown = settingsFieldFromScope(scope, "unknownAnswerFallback", true, false);
  const unknownPlanPromise = ownsUnknown
    ? planUnknownAnswerSave({
        submitted: formData.get("unknown_answer_fallback"),
        storedSpoken: tenant.unknown_answer_spoken,
        editedEn: String(formData.get("unknown_answer_spoken_en") || ""),
        editedSw: String(formData.get("unknown_answer_spoken_sw") || ""),
        touched: String(formData.get("unknown_answer_spoken_touched") || "") === "1",
        generate: generateUnknownAnswerSpoken,
      })
    : null;

  const compileInput = {
    businessName,
    servicesOffered,
    businessHours,
    agentTone: agentTone ?? DEFAULT_AGENT_TONE,
    agentName,
    teamDirectory,
    faqs,
    unknownAnswerFallback,
    escalateEnabled: agentTools.escalate,
    vertical,
    handoffMode,
    locationsText,
    policiesText,
    productsText: productsBlock,
    socialText: socialBlock,
    productCatalog,
    businessPolicies,
    fieldMeta: compileFieldMeta,
    holdGate: provenance.holdGate,
  };
  // Fast path: write the facts with the template prompt now (milliseconds), so the owner
  // sees "Saved" quickly and a reload shows the new data. The model-written prompt and
  // the fact bookkeeping run after the response (see after() below).
  const [{ prompt }, unknownPlan] = await Promise.all([
    compileReceptionistPrompt({ ...compileInput, localOnly: true }),
    unknownPlanPromise,
  ]);
  const unknownAnswerSpoken = unknownPlan?.unknown_answer_spoken ?? null;
  const source = "local" as const;

  patch.llm_system_prompt = prompt;
  if (unknownPlan) Object.assign(patch, unknownPlan);
  const tCompile = Date.now();
  // count: RLS (owner/admin only) filters a denied update to 0 rows with no error.
  let { error, count } = await workspace.client.from("tenants").update(patch, { count: "exact" }).eq("id", tenant.id);
  // Spoken When unsure pair: not migrated, or no owner UPDATE grant yet. Save the rest.
  let spokenSkipped = false;
  if (error) {
    const peeled = withoutUnknownSpokenColumn(error.message, patch);
    if (peeled) {
      spokenSkipped = true;
      ({ error, count } = await workspace.client
        .from("tenants")
        .update(peeled, { count: "exact" })
        .eq("id", tenant.id));
    }
  }
  bustTenantCache(tenant.id);
  const tWrite = Date.now();

  if (error) {
    return ownerSaveFailed("settings.save", error.message);
  }
  if (saveMatchedNoRows(count)) {
    return { error: deniedMessage(null, "settings.edit") };
  }
  if (ownsServices || ownsProducts) {
    // Old catalogue tab (#997 sends it to the Catalogue once the KB tables exist): new rows are added to kb_items,
    // price/name edits reach existing items, but never their state (paused / not offered / held / not included) and
    // nothing is hidden. The mirror then rewrites the old columns + services_offered from the KB.
    await importCatalogueToKb(
      tenant.id,
      { ...(ownsServices ? { services_catalog: servicesCatalog } : {}), ...(ownsProducts ? { product_catalog: productCatalog } : {}) },
      { legacyServicesOffered: servicesOffered, by: "settings", notes: servicesNotes, contentEdits: true },
    );
  }
  requestSpokenCatalogueCompile(tenant.id, patch);

  const socialChannels = socialHandles?.channels;
  const hasSocialHandles =
    Array.isArray(socialChannels) &&
    socialChannels.some((row) => row && String(row.value || "").trim());

  const pathsFromSave = fieldPathsAttestedOnSettingsSave({
    scope,
    businessName,
    vertical,
    spokenName,
    agentName,
    agentTone,
    agentTools,
    hasStructuredHours: Boolean(scheduleForSave),
    businessHoursLength: businessHours.length,
    businessLocationsCount: businessLocations.length,
    businessPolicies,
    productCatalog,
    servicesCatalog,
    faqs,
    hasSocialHandles,
    lineNumber: String(tenant.sautikit_virtual_number || "").trim(),
    serviceAreas: formAreas ?? null,
  });

  const client = workspace.client;
  // Request-scoped reads (cookies) must happen before after().
  const attestUser = hashMode ? null : await getAuthUser();
  console.info(
    `[settings-save timing] scope=${scope || "all"} auth=${tAuth - t0}ms parse=${tPrep - tAuth}ms reads=${tReads - tPrep}ms compile=${tCompile - tReads}ms write=${tWrite - tCompile}ms total=${Date.now() - t0}ms`
  );
  after(async () => {
   try {
    // Upgrade to the model-written prompt only if no newer save replaced ours meanwhile.
    // Bounded so the background work always ends well inside the function's time limit.
    try {
      const upgraded = await Promise.race([
        compileReceptionistPrompt(compileInput),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PROMPT_UPGRADE_BUDGET_MS)),
      ]);
      const better = upgraded?.prompt;
      const how = upgraded?.source;
      if (how === "gemini" && better && better !== prompt) {
        await client.from("tenants").update({ llm_system_prompt: better }).eq("id", tenant.id).eq("llm_system_prompt", prompt);
        bustTenantCache(tenant.id);
      }
    } catch (err) {
      console.warn("[settings.save] prompt upgrade skipped:", err instanceof Error ? err.message : err);
    }
    if (hashMode) {
      // Hash the stored row as saved. If it cannot be read back, confirm nothing:
      // in hash mode a missing value_hash already reads as "Check this".
      const saved = await readSavedFactRow(client, tenant.id);
      if (saved) {
        await ownerConfirmPlan(
          tenant.id,
          planFactConfirm({
            scope,
            before: storedFactRow,
            after: saved,
            explicitPaths,
            normalize: normalizeFactRow,
            saveIsConfirm,
          })
        );
      } else {
        console.warn("[settings.save] saved row unreadable, owner confirm skipped");
      }
    } else {
      await ownerAttestFields(
        tenant.id,
        cleanFieldPaths([...pathsFromSave, ...ownerPathsFromForm]),
        attestUser?.id ?? null
      );
    }
   } catch (err) {
    console.warn("[settings.save] background work failed:", err instanceof Error ? err.message : err);
   }
  });

  revalidatePath("/settings");

  // A skipped spoken pair stays as stored, so the form shows what callers hear.
  const storedSpoken = (tenant.unknown_answer_spoken ?? null) as typeof unknownAnswerSpoken;
  const spokenState = ownsUnknown
    ? { unknownAnswerSpoken: spokenSkipped ? storedSpoken : unknownAnswerSpoken }
    : {};
  const spokenLost =
    spokenSkipped && JSON.stringify(unknownAnswerSpoken ?? null) !== JSON.stringify(storedSpoken ?? null);
  if (priceIssues.length) {
    return { ok: true, source, error: priceIssueSummary(priceIssues, true), fields: priceFields, ...spokenState };
  }

  if (spokenLost) {
    return { ok: true, source, error: "Saved. The spoken When unsure lines could not be updated yet.", ...spokenState };
  }

  return { ok: true, source, ...spokenState };
}

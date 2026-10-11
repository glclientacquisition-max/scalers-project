"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignDidFromPool } from "@/lib/tenant";
import { allowRate } from "@/lib/rateLimit";
import { readSetupRow, emailConfirmed } from "@/lib/setupServer";
import {
  catalogueForTenant,
  faqsForTenant,
  firstInvalidStep,
  hoursSchedule,
  hoursText,
  notifyChannelsFor,
  numberPending,
  parseDraft,
  saveErrorMessage,
  SETUP_STEPS,
  stepIndex,
  validateStep,
  type FieldErrors,
  type SetupDraft,
  type StepKey,
} from "@/lib/setupFlow";
import { compileReceptionistPrompt } from "@/lib/promptCompiler";
import { compilePromptLocally, tenantNeedsOnboarding, type OnboardingAnswers } from "@/lib/onboarding";
import { formatLocationsForCompiler } from "@/lib/businessLocations";
import { formatProductsForCompiler, normalizeProductCatalog } from "@/lib/productCatalog";
import { formatServicesForCompiler, normalizeServicesCatalog } from "@/lib/servicesCatalog";
import { seedOwnerCatchAllTeam } from "@/lib/retailOnboardingPack";
import { ownerAttestFields } from "@/lib/ownerAttestFields";
import { fieldPathsAttestedOnAlertsSave, fieldPathsAttestedOnSettingsSave } from "@/lib/fieldPathsFromSettingsSave";
import { notifyNumberPending } from "@/lib/setupNotify";
import { deskMemberRole } from "@/lib/requireMember";
import { can } from "@/lib/permissions";

export type SaveStepResult =
  | { ok: true; version: number; furthest: number }
  | { ok: false; conflict?: undefined; error: string; fields?: FieldErrors }
  /** Another tab saved first. The client replaces its draft with this one. */
  | { ok: false; conflict: true; error: string; draft: SetupDraft; version: number; furthest: number };

const UNAVAILABLE = "Couldn't save because of a server error. Try again, or contact support.";

const SETUP_DENIED = "Only the owner or an admin can set up this business.";

/** One membership read (none when team invites are off). Viewers and staff can't run setup. */
async function canEditSetup(tenantId: string): Promise<boolean> {
  const role = await deskMemberRole(tenantId);
  return role !== null && can(role, "settings.edit");
}

async function signedInClient() {
  const user = await getAuthUser();
  if (!user || !emailConfirmed(user)) return null;
  return { user, client: await createSupabaseServerClient() };
}

/**
 * Save one step. Validates on the server, then one RPC merges it into tenants.onboarding_draft
 * with an optimistic version check. Safe to retry: a repeat with a stale version returns the
 * latest draft instead of overwriting it.
 */
export async function saveSetupStepAction(input: {
  tenantId: string;
  key: StepKey;
  value: unknown;
  version: number;
  vertical: string;
}): Promise<SaveStepResult> {
  const started = Date.now();
  const index = stepIndex(input.key);
  if (index < 0) return { ok: false, error: UNAVAILABLE };
  // Validate before any network work: bad input answers instantly.
  const context = parseDraft({ business: { vertical: input.vertical } });
  const checked = validateStep(input.key, input.value, context);
  if (!checked.ok) return { ok: false, error: checked.error, fields: checked.fields };

  const auth = await signedInClient();
  if (!auth) return { ok: false, error: "Your session ended. Sign in again to keep going." };
  const authMs = Date.now() - started;
  // Role check and save run together (one round trip instead of two). The tenants RLS
  // update policy already refuses non-admins, so the parallel write is never a bypass.
  const [allowed, { data, error }] = await Promise.all([
    canEditSetup(input.tenantId),
    auth.client.rpc("save_onboarding_step", {
      p_tenant_id: input.tenantId,
      p_key: input.key,
      p_value: checked.value,
      p_next_step: Math.min(index + 1, SETUP_STEPS.length - 1),
      p_expected_version: input.version,
    }),
  ]);
  console.info(`[setup] save ${input.key} auth=${authMs}ms total=${Date.now() - started}ms`);
  if (!allowed) return { ok: false, error: SETUP_DENIED };
  if (error) {
    console.error("[setup] save step:", error.code, error.message);
    return { ok: false, error: saveErrorMessage(error) };
  }
  if (typeof data === "number") {
    return { ok: true, version: data, furthest: Math.min(index + 1, SETUP_STEPS.length - 1) };
  }

  // NULL: version moved (another tab), setup already finished, or no access.
  const { data: row } = await readSetupRow(auth.client, input.tenantId);
  if (!row) return { ok: false, error: "You don't have access to this workspace." };
  if (row.setup_completed_at) redirect("/onboarding/line");
  return {
    ok: false,
    conflict: true,
    error: "Setup was changed in another tab or device. We loaded the latest version.",
    draft: parseDraft(row.onboarding_draft, { phone: row.whatsapp_notification_number, email: row.alert_email }),
    version: row.onboarding_draft_version,
    furthest: row.onboarding_step,
  };
}

export type FinishResult = { ok: false; error: string; step?: StepKey; conflict?: boolean };

/**
 * Finish setup from the saved draft (the server copy is the truth, not the browser).
 * One conditional update writes the profile and setup_completed_at; a second click or a
 * second tab finds setup already done and goes straight to the line screen.
 */
export async function finishSetupAction(input: { tenantId: string; version: number }): Promise<FinishResult> {
  const auth = await signedInClient();
  if (!auth) return { ok: false, error: "Your session ended. Sign in again to finish." };
  if (!(await canEditSetup(input.tenantId))) return { ok: false, error: SETUP_DENIED };

  const { data: row, error: readErr } = await readSetupRow(auth.client, input.tenantId);
  if (readErr) {
    console.error("[setup] finish read:", readErr.code, readErr.message);
    return { ok: false, error: saveErrorMessage(readErr, "finish") };
  }
  if (!row) return { ok: false, error: "You don't have access to this workspace." };
  if (row.setup_completed_at) redirect("/onboarding/line");
  if (row.onboarding_draft_version !== input.version) {
    return { ok: false, conflict: true, error: "Setup was changed in another tab. Review this step, then finish again." };
  }

  const draft = parseDraft(row.onboarding_draft, { phone: row.whatsapp_notification_number, email: row.alert_email });
  const invalid = firstInvalidStep(draft);
  if (invalid >= 0) {
    const key = SETUP_STEPS[invalid].key;
    const result = validateStep(key, draft[key], draft);
    return { ok: false, step: key, error: result.ok ? UNAVAILABLE : result.error };
  }

  const vertical = draft.business.vertical;
  const { services, products } = catalogueForTenant(draft.catalogue, vertical);
  const servicesCatalog = normalizeServicesCatalog(services).filter((r) => r.name);
  const productCatalog = normalizeProductCatalog(products);
  const servicesOffered =
    vertical === "home_services" ? formatServicesForCompiler(servicesCatalog, "") : formatProductsForCompiler(productCatalog);
  const productsText = formatProductsForCompiler(productCatalog);
  const hoursOn = !draft.hours.skipped;
  const businessHours = hoursOn ? hoursText(draft.hours.days) : "";
  const faqs = faqsForTenant(draft.faqs);
  const alerts = draft.alerts;
  const locations =
    draft.business.landmark || draft.business.directions
      ? [{ label: "Main", address: draft.business.landmark, landmark: draft.business.landmark, directions: draft.business.directions, coverage_notes: "" }]
      : [];
  const locationsText = formatLocationsForCompiler(locations);
  const teamDirectory = seedOwnerCatchAllTeam({
    businessName: row.business_name,
    whatsapp: alerts.phone || null,
    email: alerts.emailOn ? alerts.email : null,
  });
  const unknownAnswerFallback = "I'll check with the owner and get back to you.";
  const voice = draft.voice;

  let prompt = "";
  try {
    ({ prompt } = await compileReceptionistPrompt({
      businessName: row.business_name,
      servicesOffered,
      businessHours,
      agentTone: voice.tone,
      agentName: voice.agentName,
      vertical,
      handoffMode: voice.handoff,
      locationsText,
      policiesText: "",
      productsText,
      faqs,
      unknownAnswerFallback,
      teamDirectory,
    }));
  } catch (err) {
    console.warn("[setup] prompt compile failed, using local:", err instanceof Error ? err.message : err);
  }
  const answers: OnboardingAnswers = { servicesPricing: servicesOffered, hoursLocation: businessHours, tone: voice.tone };
  if (!prompt || prompt.length < 80 || tenantNeedsOnboarding({ business_name: row.business_name, llm_system_prompt: prompt })) {
    prompt = compilePromptLocally(row.business_name, answers, {
      agentName: voice.agentName,
      faqs,
      unknownAnswerFallback,
      teamDirectory,
      vertical,
      handoffMode: voice.handoff,
      locationsText,
      policiesText: "",
      productsText,
    });
  }

  const patch: Record<string, unknown> = {
    services_offered: servicesOffered,
    services_catalog: servicesCatalog,
    product_catalog: productCatalog,
    business_hours: businessHours,
    agent_tone: voice.tone,
    agent_name: voice.agentName,
    vertical,
    handoff_mode: voice.handoff,
    business_locations: locations,
    faqs,
    llm_system_prompt: prompt,
    agent_tools: { escalate: true, end_call: true },
    after_hours_mode: "serve",
    unknown_answer_fallback: unknownAnswerFallback,
    whatsapp_notification_number: alerts.phone || null,
    alert_email: alerts.email || null,
    notify_channels: notifyChannelsFor(alerts),
    setup_completed_at: new Date().toISOString(),
    onboarding_step: SETUP_STEPS.length,
  };
  if (hoursOn) patch.hours_schedule = hoursSchedule(draft.hours.days, draft.business.landmark);
  if (teamDirectory.length) patch.team_directory = teamDirectory;

  const { data: updated, error } = await auth.client
    .from("tenants")
    .update(patch)
    .eq("id", row.id)
    .is("setup_completed_at", null)
    .eq("onboarding_draft_version", input.version)
    .select("id, sautikit_virtual_number");
  if (error) {
    console.error("[setup] finish:", error.code, error.message);
    return { ok: false, error: `${saveErrorMessage(error, "finish")} Your answers are saved.` };
  }
  if (!updated?.length) {
    // Lost a race with another tab: either it finished (go on) or it edited (review).
    const { data: again } = await readSetupRow(auth.client, row.id);
    if (again?.setup_completed_at) redirect("/onboarding/line");
    return { ok: false, conflict: true, error: "Setup was changed in another tab. Review this step, then finish again." };
  }

  let number = updated[0].sautikit_virtual_number as string | null;
  if (numberPending(number)) number = (await assignDidFromPool(row.id)) || number;
  const pending = numberPending(number);
  const userId = auth.user.id;

  // Bookkeeping after the response: provenance (bounded list) and the ops heads-up.
  after(async () => {
    const paths = [
      ...fieldPathsAttestedOnSettingsSave({
        scope: "all",
        vertical,
        agentName: voice.agentName,
        agentTone: voice.tone,
        hasStructuredHours: hoursOn,
        businessLocationsCount: locations.length,
        productCatalog: productCatalog.slice(0, 20),
        servicesCatalog: servicesCatalog.slice(0, 20),
        faqs,
      }),
      // Setup is the owner's own confirmation of these too (Overview completeness).
      "identity.business_name",
      "identity.language",
      "assistant.tools",
      ...fieldPathsAttestedOnAlertsSave({
        whatsappNumber: alerts.phone || null,
        alertEmail: alerts.email || null,
        hasNotifyChannels: true,
      }),
    ];
    try {
      await ownerAttestFields(row.id, paths, userId);
    } catch (err) {
      console.warn("[setup] attest:", err instanceof Error ? err.message : err);
    }
    if (pending) await notifyNumberPending({ tenantId: row.id, businessName: row.business_name });
  });

  redirect("/onboarding/line");
}

export type RetryNumberResult = { ok: true; number: string } | { ok: false; pending?: boolean; error: string };

/** Owner taps "Try again" on the line screen. Membership is checked by reading the row under RLS. */
export async function retryNumberAction(tenantId: string): Promise<RetryNumberResult> {
  const auth = await signedInClient();
  if (!auth) return { ok: false, error: "Your session ended. Sign in again." };
  const { data: row } = await readSetupRow(auth.client, tenantId);
  if (!row) return { ok: false, error: "You don't have access to this workspace." };
  if (!numberPending(row.sautikit_virtual_number)) return { ok: true, number: String(row.sautikit_virtual_number) };
  if (!(await allowRate(`number-retry:${tenantId}`, 30, 1))) {
    return { ok: false, pending: true, error: "Give it 30 seconds, then try again." };
  }
  const assigned = await assignDidFromPool(tenantId);
  if (assigned && !numberPending(assigned)) return { ok: true, number: assigned };
  after(() => notifyNumberPending({ tenantId, businessName: row.business_name }));
  return { ok: false, pending: true, error: "Still no number free. We've told our team, and it will appear here as soon as one is assigned." };
}

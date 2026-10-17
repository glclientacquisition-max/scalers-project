"use server";

import { revalidatePath } from "next/cache";
import { bustTenantCache } from "@/lib/tenantCache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { getAuthUser } from "@/lib/auth";
import { ownerAttestFields } from "@/lib/ownerAttestFields";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/lib/faqs";
import { questionKey } from "@/lib/callInsights";

export type AddFaqResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Owner answers a question callers asked that the Business Assistant could not.
 * Saved as an owner FAQ (trusted), so it is used from the next call.
 */
export async function addFaqFromInsightAction(input: { question: string; answer: string }): Promise<AddFaqResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error ?? "Your role can't do this." };
  const question = String(input.question || "").trim().replace(/\s+/g, " ");
  const answer = String(input.answer || "").trim();
  if (!question) return { ok: false, error: "Write the question." };
  if (!answer) return { ok: false, error: "Write the answer callers should hear." };
  if (question.length > FAQ_QUESTION_MAX) return { ok: false, error: `Keep the question under ${FAQ_QUESTION_MAX} characters.` };
  if (answer.length > FAQ_ANSWER_MAX) return { ok: false, error: `Keep the answer under ${FAQ_ANSWER_MAX} characters.` };

  const tenant = await getCurrentTenant();
  const ws = await createWorkspaceDataClient();
  if (!tenant || !ws) return { ok: false, error: "Not signed in." };

  const faqs = Array.isArray(tenant.faqs) ? [...tenant.faqs] : [];
  const key = questionKey(question);
  const at = faqs.findIndex((f) => questionKey(String((f as { question?: unknown })?.question ?? "")) === key);
  const row = { question, answer, source: "owner" };
  if (at >= 0) faqs[at] = { ...faqs[at], ...row };
  else faqs.push(row);

  const { error } = await ws.client.from("tenants").update({ faqs }).eq("id", tenant.id);
  bustTenantCache(tenant.id);
  if (error) return { ok: false, error: "Couldn't save. Try again." };

  const user = await getAuthUser();
  await ownerAttestFields(tenant.id, [`faqs.${(at >= 0 ? at : faqs.length - 1) + 1}`], user?.id ?? null);
  revalidatePath("/home");
  revalidatePath("/settings");
  return { ok: true, message: "Saved. Your Business Assistant uses it from the next call." };
}

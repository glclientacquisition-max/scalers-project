"use server";

import { draftErrors, type Draft } from "@/lib/policyRegistry";

export type PolicySaveResult = { ok: true } | { ok: false; error: string };

/** Dev harness save: writes nothing. Off unless DASHBOARD_OPEN=true. */
export async function devSavePolicyTopicAction(_topic: string, draft: Draft): Promise<PolicySaveResult> {
  if (process.env.DASHBOARD_OPEN !== "true") return { ok: false, error: "Not available." };
  const errs = draftErrors(draft);
  return errs.length ? { ok: false, error: errs.map((e) => e.summary).join(". ") } : { ok: true };
}

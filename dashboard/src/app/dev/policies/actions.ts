"use server";

import type { PolicySaveResult } from "@/app/(desk)/settings/policies/actions";
import { draftErrors, type Draft } from "@/lib/policyRegistry";

/** Dev harness save: writes nothing. Off unless DASHBOARD_OPEN=true. */
export async function devSavePolicyTopicAction(_topic: string, draft: Draft): Promise<PolicySaveResult> {
  if (process.env.DASHBOARD_OPEN !== "true") return { ok: false, error: "Not available." };
  const errs = draftErrors(draft);
  return errs.length ? { ok: false, error: errs.map((e) => e.summary).join(". ") } : { ok: true };
}

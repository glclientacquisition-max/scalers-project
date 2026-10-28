"use client";

import type { ReactNode } from "react";
import { PoliciesSettings, type PoliciesSheetState } from "@/components/policies/PoliciesSettings";
import type { TenantRow } from "@/lib/supabase";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fixture saves: a short delay, then OK (or a failure with ?fail=1, to see Try again). */
export function DevPolicies({ tenant, fail, sheet, sidebar }: { tenant: TenantRow; fail: boolean; sheet: PoliciesSheetState | null; sidebar?: ReactNode }) {
  return (
    <PoliciesSettings
      tenant={tenant}
      heading="Policies"
      sidebar={sidebar}
      initialSheet={sheet}
      saveCard={async () => {
        await wait(500);
        return fail ? { ok: false, error: "Couldn't save. Check your connection and try again." } : { ok: true };
      }}
      saveUnknown={async (input) => {
        await wait(500);
        if (fail) return { error: "Couldn't save. Check your connection and try again." };
        return { ok: true, unknownAnswerSpoken: input.line ? { en: input.line, sw: "", source: input.line } : null };
      }}
    />
  );
}

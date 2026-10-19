/**
 * Owner plan changes the Desk calls. Screens stay off unless
 * process.env.DESK_PLAN_CHANGE is the exact value "on". SQL does not read
 * the flag. This module does.
 * Production Supabase is refused here so a Desk deploy cannot write it.
 * No payment provider.
 */

export const PRODUCTION_SUPABASE_REF = "fjxcdccgyhnvnnlnovcl";

export type OwnerBillingCode =
  | "disabled"
  | "production_refused"
  | "sign_in"
  | "no_workspace"
  | "forbidden";

export type OwnerBillingRefusal = {
  ok: false;
  code: OwnerBillingCode;
  message: string;
};

export function deskPlanChangeOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DESK_PLAN_CHANGE === "on";
}

export function billingWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  return !url.includes(PRODUCTION_SUPABASE_REF);
}

export function ownerBillingRefusal(input: {
  env?: NodeJS.ProcessEnv;
  userId?: string | null;
  tenantId?: string | null;
  role?: string | null;
}): OwnerBillingRefusal | null {
  const env = input.env ?? process.env;
  if (!deskPlanChangeOn(env)) {
    return { ok: false, code: "disabled", message: "Plan changes are switched off." };
  }
  if (!billingWritesAllowed(env)) {
    return {
      ok: false,
      code: "production_refused",
      message: "Plan changes are not on this database.",
    };
  }
  if (!input.userId) {
    return { ok: false, code: "sign_in", message: "Sign in first." };
  }
  if (!input.tenantId) {
    return { ok: false, code: "no_workspace", message: "No workspace linked to this account." };
  }
  if (input.role !== "owner" && input.role !== "admin") {
    return {
      ok: false,
      code: "forbidden",
      message: "Only an owner or an admin can change the plan.",
    };
  }
  return null;
}

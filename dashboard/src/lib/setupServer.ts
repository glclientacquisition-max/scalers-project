import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getVerifiedAuthUser as getAuthUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ownerTenantId } from "@/lib/tenant";
import { parseDraft, type SetupDraft } from "@/lib/setupFlow";

/** Everything setup needs, in one row read. */
export const SETUP_SELECT =
  "id, business_name, whatsapp_notification_number, alert_email, sautikit_virtual_number, setup_completed_at, onboarding_draft, onboarding_step, onboarding_draft_version, business_policies";

export type SetupRow = {
  id: string;
  business_name: string;
  whatsapp_notification_number: string | null;
  alert_email: string | null;
  sautikit_virtual_number: string | null;
  setup_completed_at: string | null;
  onboarding_draft: unknown;
  onboarding_step: number;
  onboarding_draft_version: number;
  business_policies?: Record<string, unknown> | null;
};

export type SetupContext =
  | { kind: "signed_out" }
  | { kind: "unconfirmed"; user: User }
  | { kind: "no_workspace"; user: User }
  /** Setup columns are not on this database yet: use the previous wizard. */
  | { kind: "legacy"; user: User }
  | { kind: "ready"; user: User; client: SupabaseClient; row: SetupRow; draft: SetupDraft };

export function isMissingSetupColumn(message: string | undefined): boolean {
  return /setup_completed_at|onboarding_draft|onboarding_step|save_onboarding_step|schema cache|does not exist/i.test(
    String(message || "")
  );
}

/** Email confirmed per Supabase. Auto-confirm projects set this at sign-up. */
export function emailConfirmed(user: User): boolean {
  return Boolean(user.email_confirmed_at || (user as { confirmed_at?: string }).confirmed_at);
}

export async function readSetupRow(client: SupabaseClient, tenantId: string) {
  return client.from("tenants").select(SETUP_SELECT).eq("id", tenantId).maybeSingle<SetupRow>();
}

/** Auth user, then membership, then one tenant row. Three round trips, no fan-out. */
export async function loadSetupContext(): Promise<SetupContext> {
  const user = await getAuthUser();
  if (!user) return { kind: "signed_out" };
  if (!emailConfirmed(user)) return { kind: "unconfirmed", user };
  const client = await createSupabaseServerClient();
  const tenantId = await ownerTenantId(client, user.id);
  if (!tenantId) return { kind: "no_workspace", user };
  const { data, error } = await readSetupRow(client, tenantId);
  if (error) {
    if (isMissingSetupColumn(error.message)) return { kind: "legacy", user };
    throw error;
  }
  if (!data) return { kind: "no_workspace", user };
  return {
    kind: "ready",
    user,
    client,
    row: data,
    draft: parseDraft(data.onboarding_draft, {
      phone: data.whatsapp_notification_number,
      email: data.alert_email || user.email,
    }),
  };
}

"use server";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { parseCreateWorkspaceInput } from "@/lib/createWorkspace";
import { ensureTenantForUser, getCurrentTenant } from "@/lib/tenant";

export type CreateWorkspaceState = { error?: string };

/** Signed-in owner with no tenant: create one for the current session (no re-signup). */
export async function createWorkspaceForSessionAction(
  _prev: CreateWorkspaceState,
  formData: FormData
): Promise<CreateWorkspaceState> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (await getCurrentTenant()) redirect("/onboarding");

  const parsed = parseCreateWorkspaceInput({
    businessName: formData.get("business_name"),
    notificationPhone: formData.get("notification_phone"),
  });
  if (!parsed.ok) return { error: parsed.error };

  try {
    await ensureTenantForUser({
      userId: user.id,
      businessName: parsed.businessName,
      notificationPhone: parsed.notificationPhone,
    });
  } catch (err) {
    console.error("[onboarding] create workspace failed:", err instanceof Error ? err.message : err);
    return { error: "Couldn't create the workspace. Try again or contact support." };
  }
  redirect("/onboarding");
}

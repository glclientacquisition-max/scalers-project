"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type ContactNotesResult = {
  ok?: boolean;
  error?: string;
};

export async function updateContactNotes(
  contactId: string,
  notes: string
): Promise<ContactNotesResult> {
  if (!(await isAuthenticated())) {
    return { error: "Not signed in." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const id = String(contactId || "").trim();
  if (!id) return { error: "Missing contact." };

  const { error } = await workspace.client
    .from("contacts")
    .update({
      notes: String(notes || "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenant.id);

  if (error) {
    if (/contacts|relation/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`,
      };
    }
    if (/row-level security|permission denied|rls/i.test(error.message)) {
      return { error: `${error.message} Owner notes update needs contacts RLS grants.` };
    }
    return { error: error.message };
  }

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

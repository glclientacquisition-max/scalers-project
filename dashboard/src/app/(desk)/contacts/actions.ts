"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import {
  planContactCsv,
  planManualContact,
  type ContactCsvPlan,
} from "@/lib/contactImport";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type ContactNotesResult = {
  ok?: boolean;
  error?: string;
};

export type CreateContactResult = {
  ok?: boolean;
  error?: string;
  id?: string;
  existingId?: string;
};

export type ContactImportPreviewState = {
  error?: string;
  ok?: boolean;
  csv?: string;
  plan?: ContactCsvPlan;
};

export type ContactImportApplyState = {
  error?: string;
  ok?: boolean;
  created?: number;
};

function contactsWriteError(message: string): string {
  if (/contacts|relation/i.test(message)) {
    return `${message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`;
  }
  if (/row-level security|permission denied|rls/i.test(message)) {
    return `${message} Apply docs/supabase/contacts_owner_insert.sql in Supabase.`;
  }
  return message;
}

async function loadWorkspace() {
  if (!(await isAuthenticated())) return null;
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return null;
  return { tenant, workspace };
}

async function existingIdForPhone(
  client: SupabaseClient,
  tenantId: string,
  phone: string
): Promise<string | null> {
  const { data } = await client
    .from("contacts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();
  return data?.id || null;
}

export async function updateContactNotes(
  contactId: string,
  notes: string
): Promise<ContactNotesResult> {
  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };

  const id = String(contactId || "").trim();
  if (!id) return { error: "Missing contact." };

  const { error } = await ctx.workspace.client
    .from("contacts")
    .update({
      notes: String(notes || "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return { error: contactsWriteError(error.message) };

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

export async function createContact(formData: FormData): Promise<CreateContactResult> {
  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };

  const phoneRaw = String(formData.get("phone") || "");
  const parsed = planManualContact({
    name: formData.get("name"),
    phone: phoneRaw,
    notes: formData.get("notes"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const existingId = await existingIdForPhone(
    ctx.workspace.client,
    ctx.tenant.id,
    parsed.phone
  );
  const gated = planManualContact({
    name: formData.get("name"),
    phone: phoneRaw,
    notes: formData.get("notes"),
    existingId,
  });
  if (!gated.ok) {
    return { error: gated.error, existingId: gated.existingId };
  }

  const now = new Date().toISOString();
  const { data, error } = await ctx.workspace.client
    .from("contacts")
    .insert({
      tenant_id: ctx.tenant.id,
      phone: gated.phone,
      name: gated.name,
      notes: gated.notes,
      metadata: gated.metadata,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (/duplicate|unique|contacts_tenant_phone/i.test(error.message)) {
      const raced = await existingIdForPhone(
        ctx.workspace.client,
        ctx.tenant.id,
        gated.phone
      );
      return { error: "Already saved", existingId: raced || undefined };
    }
    return { error: contactsWriteError(error.message) };
  }
  if (!data?.id) return { error: "Could not save contact." };

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${data.id}`);
  return { ok: true, id: data.id };
}

export async function previewContactCsv(
  _prev: ContactImportPreviewState,
  formData: FormData
): Promise<ContactImportPreviewState> {
  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };

  const file = formData.get("csv");
  let csv = String(formData.get("csvText") || "");
  if (
    file &&
    typeof file !== "string" &&
    "text" in file &&
    Number((file as File).size) > 0
  ) {
    csv = await (file as File).text();
  }
  if (!csv.trim()) return { error: "Choose a CSV file." };

  const phonesProbe = planContactCsv(csv, {});
  if (!phonesProbe.ok) return { error: phonesProbe.error };

  const phones = [
    ...new Set([
      ...phonesProbe.create.map((row) => row.phone),
      ...phonesProbe.skipped.map((row) => row.phone),
      ...phonesProbe.rejected
        .map((row) => row.phone)
        .filter((phone): phone is string => Boolean(phone && phone.startsWith("+"))),
    ]),
  ];
  const existingByPhone: Record<string, string> = {};
  if (phones.length) {
    const { data, error } = await ctx.workspace.client
      .from("contacts")
      .select("id, phone")
      .eq("tenant_id", ctx.tenant.id)
      .in("phone", phones);
    if (error) return { error: contactsWriteError(error.message) };
    for (const row of data || []) {
      if (row.phone) existingByPhone[row.phone] = row.id;
    }
  }

  const plan = planContactCsv(csv, existingByPhone);
  if (!plan.ok) return { error: plan.error };
  return { ok: true, csv, plan };
}

export async function applyContactCsv(
  _prev: ContactImportApplyState,
  formData: FormData
): Promise<ContactImportApplyState> {
  const ctx = await loadWorkspace();
  if (!ctx) return { error: "Not signed in." };
  if (String(formData.get("confirm") || "") !== "1") {
    return { error: "Confirm the import first." };
  }

  const csv = String(formData.get("csvText") || "");
  if (!csv.trim()) return { error: "Choose a CSV file." };

  const preview = await previewContactCsv({}, formData);
  if (!preview.ok || !preview.plan) return { error: preview.error || "Could not plan import." };

  const rows = preview.plan.create;
  if (!rows.length) return { ok: true, created: 0 };

  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    tenant_id: ctx.tenant.id,
    phone: row.phone,
    name: row.name,
    notes: row.notes,
    metadata: row.metadata,
    updated_at: now,
  }));

  const { error } = await ctx.workspace.client.from("contacts").insert(payload);
  if (error) return { error: contactsWriteError(error.message) };

  revalidatePath("/contacts");
  return { ok: true, created: payload.length };
}

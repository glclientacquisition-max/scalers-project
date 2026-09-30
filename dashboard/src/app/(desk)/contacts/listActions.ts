"use server";

import {
  loadContactsPage,
  resolveContactSavedFilter,
  resolveContactSort,
  type ContactListRow,
} from "@/lib/contactsLoad";
import { DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export async function loadContactsSlice(input: {
  page: number;
  saved?: string;
  sort?: string;
  q?: string;
}): Promise<{ rows: ContactListRow[]; total: number; error: string | null }> {
  const page = Math.min(500, Math.max(1, Math.floor(Number(input?.page) || 1)));
  const tenant = await getCurrentTenant();
  const workspace = tenant ? await createWorkspaceDataClient() : null;
  if (!tenant || !workspace) {
    return { rows: [], total: 0, error: "Not signed in." };
  }
  return loadContactsPage(
    workspace.client,
    tenant.id,
    page,
    DEFAULT_PAGE_SIZE,
    resolveContactSavedFilter(input?.saved),
    { q: input?.q, sort: resolveContactSort(input?.sort) }
  );
}

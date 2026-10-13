"use server";

import { memberDenied } from "@/lib/requireMember";

import { loadCachedInboxItems } from "@/lib/inboxLoad";
import type { InboxItem } from "@/lib/inboxPurpose";
import { getCurrentTenant } from "@/lib/tenant";

/** Fresh inbox pile for a phone pull. Does not replace the rows already on screen when it fails. */
export async function refreshInboxList(): Promise<{
  items: InboxItem[];
  error: string | null;
  partialError: string | null;
}> {
  const denied = await memberDenied("inbox.view");
  if (denied) return { items: [], error: denied.error, partialError: null };
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { items: [], error: "Not signed in.", partialError: null };
  }
  const loaded = await loadCachedInboxItems(tenant.id, tenant.vertical);
  return {
    items: loaded.items,
    error: loaded.error,
    partialError: loaded.partialError,
  };
}

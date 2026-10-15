import { revalidateTag, updateTag } from "next/cache";

/** One tag per workspace. Never shared across tenants. */
export function tenantCacheTag(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Drop the cached tenant row after a write. In a server action updateTag gives
 * read-your-writes on the next render; elsewhere (route handlers) expire it now.
 */
export function bustTenantCache(tenantId: string | null | undefined): void {
  if (!tenantId) return;
  const tag = tenantCacheTag(tenantId);
  try {
    updateTag(tag);
  } catch {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      /* outside a request: the 15 s window covers it */
    }
  }
}

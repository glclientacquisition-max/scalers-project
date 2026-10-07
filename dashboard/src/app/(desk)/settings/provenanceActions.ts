"use server";

import { cleanFieldPaths } from "@/lib/fieldPathRegistry";
import { ownerAttestFields } from "@/lib/ownerAttestFields";

/** Server-side stamp when a flow cannot use the normal Settings save action. */
export async function stampOwnerFieldPaths(tenantId: string, fieldPaths: string[]): Promise<void> {
  const paths = cleanFieldPaths(fieldPaths);
  if (!paths.length) return;
  await ownerAttestFields(tenantId, paths, null);
}

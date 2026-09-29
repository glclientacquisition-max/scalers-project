import { DeskTenantSelect } from "@/components/DeskTenantSelect";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { listOwnerWorkspaces } from "@/lib/tenant";

/** Persistent workspace name and sign-out. Static. Not a second header lockup. */
export async function DeskAccountBar({
  tenantId,
  businessName,
}: {
  tenantId: string;
  businessName: string | null;
}) {
  const workspaces = tenantId ? await listOwnerWorkspaces() : [];
  const name = businessName?.trim() || "Workspace";
  const many = workspaces.length > 1;

  return (
    <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4 sm:px-6">
      {many ? (
        <DeskTenantSelect tenantId={tenantId} workspaces={workspaces} />
      ) : (
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</p>
      )}
      <SignOutButton />
    </div>
  );
}

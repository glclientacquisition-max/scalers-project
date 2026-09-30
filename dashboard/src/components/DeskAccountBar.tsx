import { DeskAccountMenu } from "@/components/DeskAccountMenu";
import { listOwnerWorkspaces } from "@/lib/tenant";

/** Quiet account strip. Phone mark on the left. Initials open the workspace name, Appearance, and Sign out. */
export async function DeskAccountBar({
  tenantId,
  businessName,
}: {
  tenantId: string;
  businessName: string | null;
}) {
  const workspaces = tenantId ? await listOwnerWorkspaces() : [];
  const name = businessName?.trim() || "Workspace";

  return (
    <DeskAccountMenu
      name={name}
      tenantId={tenantId}
      workspaces={workspaces.map((row) => ({
        id: row.id,
        name: row.business_name?.trim() || "Workspace",
      }))}
    />
  );
}

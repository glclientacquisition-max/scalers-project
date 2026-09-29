"use client";

import { switchDeskTenant } from "@/app/(desk)/tenantActions";
import { deskFieldClass } from "@/components/ui/deskChrome";

export function DeskTenantSelect({
  tenantId,
  workspaces,
}: {
  tenantId: string;
  workspaces: Array<{ id: string; business_name: string | null }>;
}) {
  return (
    <form action={switchDeskTenant} className="min-w-0 flex-1">
      <label className="sr-only" htmlFor="desk-tenant">
        Workspace
      </label>
      <select
        id="desk-tenant"
        name="tenant_id"
        defaultValue={tenantId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={deskFieldClass}
      >
        {workspaces.map((row) => (
          <option key={row.id} value={row.id}>
            {row.business_name?.trim() || "Workspace"}
          </option>
        ))}
      </select>
    </form>
  );
}

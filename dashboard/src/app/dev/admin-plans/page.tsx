import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPackageVersionsPanel } from "@/components/AdminPackageVersionsPanel";
import { AdminShell } from "@/components/AdminNav";
import { ADMIN_PLANS_BUSINESSES, ADMIN_PLANS_CATALOG } from "../fixtures/adminPlans";

/** Plans editor fixture. DASHBOARD_OPEN=true only. */
export const instant = false;

export default function DevAdminPlansPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();

  return (
    <AdminShell operatorName="alvin">
      <AdminPageHeader title="Plans" />
      <AdminPackageVersionsPanel
        catalog={ADMIN_PLANS_CATALOG}
        businesses={ADMIN_PLANS_BUSINESSES}
        planWritesEnabled
      />
    </AdminShell>
  );
}

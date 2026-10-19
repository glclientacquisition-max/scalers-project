import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPaymentsStatus } from "@/components/AdminPaymentsStatus";
import { AdminShell } from "@/components/AdminNav";
import { ADMIN_BACHS_STATUS } from "../fixtures/adminBilling";

/** Bachs status fixture. DASHBOARD_OPEN=true only. Secrets never render. */
export default function DevAdminPaymentsPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();

  return (
    <AdminShell operatorName="alvin">
      <AdminPageHeader title="Payments" subtitle="Bachs status. Collections stay off." />
      <AdminPaymentsStatus status={ADMIN_BACHS_STATUS} />
    </AdminShell>
  );
}

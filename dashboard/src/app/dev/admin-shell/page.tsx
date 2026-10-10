import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminNav";
import { BusyToday } from "../admin-overview/fixture";

/**
 * Super Admin rail, phone tabs, and More sheet around the Today fixture. DASHBOARD_OPEN=true only.
 * Off the /admin path, so no tab is lit here.
 */
export default function DevAdminShellPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return (
    <AdminShell operatorName="alvin">
      <BusyToday />
    </AdminShell>
  );
}

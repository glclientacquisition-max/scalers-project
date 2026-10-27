import { Suspense } from "react";
import { AdminShell } from "@/components/AdminNav";
import { AdminPhonePull } from "@/components/PhonePullSurface";
import { StepUpHost } from "@/components/ops/StepUpHost";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { getAdminSession } from "@/lib/auth";
import { isAdminV2Enabled } from "@/lib/adminV2";
import { countPendingAccessRequests } from "@/lib/accessRequestQueries";
import { getSupabaseAdmin } from "@/lib/supabase";
import "@/styles/admin-v2.css";

// instant = false: Super Admin cookie session must run before chrome. Do not wrap the gate in Suspense.
export const instant = false;

/**
 * Super Admin shell.
 * md+: own icon rail. Phone: the same list as bottom tabs. Nested screens lead with the parent list.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Signed out, or an owner session only: always the admin login (folds in #434). Pages repeat this.
  await requireSuperAdmin();

  const adminSession = await getAdminSession();
  const operatorName = adminSession?.user?.name || "ops";

  let accessRequestsPendingCount = 0;
  if (isAdminV2Enabled()) {
    try {
      accessRequestsPendingCount = await countPendingAccessRequests(getSupabaseAdmin());
    } catch {
      accessRequestsPendingCount = 0;
    }
  }

  return (
    <AdminShell
      operatorName={operatorName}
      v2={process.env.ADMIN_V2 === "on"}
      showAccessRequests={isAdminV2Enabled()}
      accessRequestsPendingCount={accessRequestsPendingCount}
    >
      <Suspense fallback={null}>
        <AdminPhonePull scroll="admin" />
      </Suspense>
      {children}
      <StepUpHost />
    </AdminShell>
  );
}

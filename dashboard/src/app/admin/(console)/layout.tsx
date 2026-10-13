import { Suspense } from "react";
import { AdminShell } from "@/components/AdminNav";
import { AdminPhonePull } from "@/components/PhonePullSurface";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { getAdminSession } from "@/lib/auth";

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

  return (
    <AdminShell operatorName={operatorName}>
      <Suspense fallback={null}>
        <AdminPhonePull scroll="admin" />
      </Suspense>
      {children}
    </AdminShell>
  );
}

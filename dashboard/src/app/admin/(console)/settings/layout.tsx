import { requireSuperAdmin } from "@/lib/adminGuard";
import type { ReactNode } from "react";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";

/** Settings tabs (ADMIN_V2 only; the old shell never reaches /admin/settings). */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  return (
    <>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      {children}
    </>
  );
}

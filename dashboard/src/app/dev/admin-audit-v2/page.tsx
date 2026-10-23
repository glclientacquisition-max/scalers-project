import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminAuditV2 } from "@/components/admin/v2/AdminAuditV2";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";
import { ADMIN_AUDIT_ACTORS, ADMIN_AUDIT_BUSINESSES, ADMIN_AUDIT_ITEMS } from "../fixtures/adminAudit";

export const instant = false;

/** Audit log fixture (ADMIN_V2 shell + Settings tabs). DASHBOARD_OPEN=true only. */
export default async function DevAdminAuditV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      <AdminAuditV2
        items={ADMIN_AUDIT_ITEMS}
        businesses={ADMIN_AUDIT_BUSINESSES}
        actors={ADMIN_AUDIT_ACTORS}
        business={null}
        actor={null}
        limit={50}
      />
    </AdminShell>
  );
}

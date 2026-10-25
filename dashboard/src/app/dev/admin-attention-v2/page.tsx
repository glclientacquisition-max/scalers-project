import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminAttentionV2 } from "@/components/admin/v2/AdminAttentionV2";
import { ADMIN_ATTENTION } from "../fixtures/adminAttention";
import { ADMIN_BUSINESS_CALLS } from "../fixtures/adminBusinesses";

export const instant = false;

/** Needs attention fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminAttentionV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminAttentionV2 items={ADMIN_ATTENTION} callsFixture={ADMIN_BUSINESS_CALLS} />
    </AdminShell>
  );
}

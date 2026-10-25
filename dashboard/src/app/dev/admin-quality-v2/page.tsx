import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminQualityV2 } from "@/components/admin/v2/AdminQualityV2";
import { fixtureBusiness, fixtureCall, fixtureReleases } from "../quality/fixtures";
import { adminQualityRows } from "../fixtures/adminQuality";

export const instant = false;

/** Quality v2 fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminQualityV2Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const range = sp.range === "30d" ? "30d" : "7d";
  const call = sp.call ? fixtureCall(sp.call) : null;
  const business = !call && sp.pane ? fixtureBusiness(sp.pane, range) : null;
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminQualityV2 base="/dev/admin-quality-v2" range={range} rows={adminQualityRows(range)} business={business} call={call} callBusiness={call ? fixtureBusiness(call.businessId, range) : null} releases={fixtureReleases()} />
    </AdminShell>
  );
}

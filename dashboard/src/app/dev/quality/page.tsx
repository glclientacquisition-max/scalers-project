import { notFound } from "next/navigation";
import { QualityIndex } from "@/components/admin/QualityIndex";
import { parseQualityRange } from "@/lib/adminQualityModel";
import { fixtureReleases, fixtureRows } from "./fixtures";

/** Super Admin Quality fixture. DASHBOARD_OPEN=true only. Blocking so searchParams do not trip the dev overlay. */
export const instant = false;

export default async function DevQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const range = parseQualityRange((await searchParams).range);
  return <QualityIndex range={range} rows={fixtureRows(range)} releases={fixtureReleases()} base="/dev/quality" />;
}

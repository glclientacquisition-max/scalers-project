import { notFound } from "next/navigation";
import { QualityIndex } from "@/components/admin/QualityIndex";
import { parseQualityRange } from "@/lib/adminQualityModel";
import { fixtureReleases, fixtureRows } from "./fixtures";

/** Super Admin Quality fixture. DASHBOARD_OPEN=true only. */
export default async function DevQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const range = parseQualityRange((await searchParams).range);
  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto min-w-0 max-w-desk">
        <QualityIndex range={range} rows={fixtureRows(range)} releases={fixtureReleases()} base="/dev/quality" />
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import { QualityIndex } from "@/components/admin/QualityIndex";

/** Empty Quality fixture. DASHBOARD_OPEN=true only. */
export default function DevQualityEmptyPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto min-w-0 max-w-desk">
        <QualityIndex range="7d" rows={[]} releases={[]} base="/dev/quality" />
      </div>
    </main>
  );
}

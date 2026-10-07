import { notFound } from "next/navigation";
import { QualityCall } from "@/components/admin/QualityCall";
import { QualityEmpty } from "@/components/admin/QualityEmpty";
import { ButtonLink } from "@/components/ui/Button";
import { qualityBusinessHref } from "@/lib/adminQualityModel";
import { fixtureCall } from "../../fixtures";

/** Call trace fixture. DASHBOARD_OPEN=true only. */
export default async function DevQualityCallPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const { id } = await params;
  const trace = fixtureCall(decodeURIComponent(id));
  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto min-w-0 max-w-desk">
        {trace ? (
          <QualityCall
            trace={trace}
            businessHref={qualityBusinessHref("/dev/quality", trace.businessId, "7d")}
          />
        ) : (
          <QualityEmpty title="No trace for this call." action={<ButtonLink href="/dev/quality">Quality</ButtonLink>} />
        )}
      </div>
    </main>
  );
}

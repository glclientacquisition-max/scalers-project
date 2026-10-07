import { notFound } from "next/navigation";
import { QualityCall } from "@/components/admin/QualityCall";
import { QualityEmpty } from "@/components/admin/QualityEmpty";
import { ButtonLink } from "@/components/ui/Button";
import { qualityBusinessHref, qualityListHref } from "@/lib/adminQualityModel";
import { fixtureCall } from "../../fixtures";

/** Call trace fixture. DASHBOARD_OPEN=true only. Blocking so params do not trip the dev overlay. */
export const instant = false;

export default async function DevQualityCallPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const { id } = await params;
  const trace = fixtureCall(decodeURIComponent(id));
  return trace ? (
    <QualityCall
      trace={trace}
      listHref={qualityListHref("/dev/quality", "7d")}
      businessHref={qualityBusinessHref("/dev/quality", trace.businessId, "7d")}
    />
  ) : (
    <QualityEmpty title="No trace for this call." action={<ButtonLink href="/dev/quality">Quality</ButtonLink>} />
  );
}

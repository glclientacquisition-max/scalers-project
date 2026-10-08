import { QualityCall } from "@/components/admin/QualityCall";
import { QualityEmpty } from "@/components/admin/QualityEmpty";
import { ButtonLink } from "@/components/ui/Button";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { getCallTrace } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { qualityBusinessHref, qualityListHref } from "@/lib/adminQualityModel";

export const instant = false;

export default async function AdminQualityCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const trace = await getCallTrace(decodeURIComponent(id));
    if (!trace) {
      return (
        <QualityEmpty
          title="No trace for this call."
          action={<ButtonLink href="/admin/quality">Quality</ButtonLink>}
        />
      );
    }
    return (
      <QualityCall
        trace={trace}
        listHref={qualityListHref("/admin/quality", "7d")}
        businessHref={qualityBusinessHref("/admin/quality", trace.businessId, "7d")}
        showRecording
      />
    );
  } catch (err) {
    logAdminError("quality-call", err);
    return <DeskLoadError>Could not load this call.</DeskLoadError>;
  }
}

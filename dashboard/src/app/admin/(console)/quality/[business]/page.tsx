import { QualityBusiness } from "@/components/admin/QualityBusiness";
import { QualityEmpty } from "@/components/admin/QualityEmpty";
import { ButtonLink } from "@/components/ui/Button";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { getBusinessQuality } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { parseQualityRange } from "@/lib/adminQualityModel";

export const instant = false;

export default async function AdminQualityBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { business } = await params;
  const range = parseQualityRange((await searchParams).range);
  try {
    const detail = await getBusinessQuality(decodeURIComponent(business), range);
    if (!detail) {
      return (
        <QualityEmpty
          title="No traced calls yet."
          action={<ButtonLink href="/admin/quality">Quality</ButtonLink>}
        />
      );
    }
    return <QualityBusiness detail={detail} range={range} />;
  } catch (err) {
    logAdminError("quality-business", err);
    return <DeskLoadError>Could not load this business.</DeskLoadError>;
  }
}

import { QualityIndex } from "@/components/admin/QualityIndex";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { listBusinessQuality, listReleaseDeltas } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { parseQualityRange } from "@/lib/adminQualityModel";

export const instant = false;

export default async function AdminQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const range = parseQualityRange((await searchParams).range);
  try {
    const [rows, releases] = await Promise.all([listBusinessQuality(range), listReleaseDeltas()]);
    return <QualityIndex range={range} rows={rows} releases={releases} />;
  } catch (err) {
    logAdminError("quality", err);
    return <DeskLoadError>Could not load quality.</DeskLoadError>;
  }
}

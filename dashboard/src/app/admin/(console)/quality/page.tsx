import { QualityIndex } from "@/components/admin/QualityIndex";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { AdminQualityV2 } from "@/components/admin/v2/AdminQualityV2";
import { getBusinessQuality, getCallTrace, listBusinessQuality, listReleaseDeltas } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { parseQualityRange } from "@/lib/adminQualityModel";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

export default async function AdminQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; pane?: string; call?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const range = parseQualityRange(sp.range);
  try {
    if (isAdminV2Enabled()) {
      // v2: list plus a URL-driven pane (?pane=business, &call=call detail).
      const [rows, releases, call] = await Promise.all([listBusinessQuality(range), listReleaseDeltas(), sp.call ? getCallTrace(sp.call) : null]);
      const paneId = call?.businessId ?? sp.pane;
      const detail = paneId ? await getBusinessQuality(paneId, range) : null;
      return (
        <AdminQualityV2
          base="/admin/quality"
          range={range}
          rows={rows}
          releases={releases}
          business={call ? null : detail}
          call={call}
          callBusiness={call ? detail : null}
        />
      );
    }
    const [rows, releases] = await Promise.all([listBusinessQuality(range), listReleaseDeltas()]);
    return <QualityIndex range={range} rows={rows} releases={releases} insights={isAdminV2Enabled()} />;
  } catch (err) {
    logAdminError("quality", err);
    return <DeskLoadError>Could not load quality.</DeskLoadError>;
  }
}

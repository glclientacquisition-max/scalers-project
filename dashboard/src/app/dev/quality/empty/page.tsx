import { notFound } from "next/navigation";
import { QualityIndex } from "@/components/admin/QualityIndex";

/** Empty Quality fixture. DASHBOARD_OPEN=true only. */
export default function DevQualityEmptyPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return <QualityIndex range="7d" rows={[]} releases={[]} base="/dev/quality" />;
}

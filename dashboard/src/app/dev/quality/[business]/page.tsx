import { notFound } from "next/navigation";
import { QualityBusiness } from "@/components/admin/QualityBusiness";
import { QualityEmpty } from "@/components/admin/QualityEmpty";
import { ButtonLink } from "@/components/ui/Button";
import { parseQualityRange } from "@/lib/adminQualityModel";
import { fixtureBusiness } from "../fixtures";

/** Business quality fixture. DASHBOARD_OPEN=true only. Blocking so params do not trip the dev overlay. */
export const instant = false;

export default async function DevQualityBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const { business } = await params;
  const range = parseQualityRange((await searchParams).range);
  const detail = fixtureBusiness(decodeURIComponent(business), range);
  return detail ? (
    <QualityBusiness detail={detail} range={range} base="/dev/quality" />
  ) : (
    <QualityEmpty title="No traced calls yet." action={<ButtonLink href="/dev/quality">Quality</ButtonLink>} />
  );
}

import { notFound } from "next/navigation";
import { AuditScreen } from "../../_screens/AuditScreen";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/activity. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; actor?: string }>;
}) {
  if (process.env.ADMIN_V2 !== "on") notFound();
  return <AuditScreen searchParams={searchParams} />;
}

import { requireSuperAdmin } from "@/lib/adminGuard";
import { redirect } from "next/navigation";
import { AuditScreen } from "../_screens/AuditScreen";

export const instant = false;

/** ADMIN_V2: lives at /admin/settings/audit. Old shell: unchanged. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; actor?: string }>;
}) {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 === "on") redirect(`/admin/settings/audit${await qs(searchParams)}`);
  return <AuditScreen searchParams={searchParams} />;
}

async function qs(sp: Promise<Record<string, string | undefined>>) {
  const p = new URLSearchParams(Object.entries(await sp).filter((e): e is [string, string] => Boolean(e[1])));
  return p.size ? `?${p}` : "";
}

import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound, redirect } from "next/navigation";

export const instant = false;

/** ADMIN_V2: Settings opens on the General hub. */
export default async function Page() {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") notFound();
  redirect("/admin/settings/general");
}

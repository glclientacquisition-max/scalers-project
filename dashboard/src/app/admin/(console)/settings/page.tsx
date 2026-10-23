import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound, redirect } from "next/navigation";

export const instant = false;

/** ADMIN_V2: Settings opens on Services until the hub lands (slice 5). */
export default async function Page() {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") notFound();
  redirect("/admin/settings/services");
}

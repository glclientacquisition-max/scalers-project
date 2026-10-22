import { notFound, redirect } from "next/navigation";

export const instant = false;

/** ADMIN_V2: Settings opens on Services until the hub lands (slice 5). */
export default function Page() {
  if (process.env.ADMIN_V2 !== "on") notFound();
  redirect("/admin/settings/services");
}

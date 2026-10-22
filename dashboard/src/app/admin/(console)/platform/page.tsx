import { requireSuperAdmin } from "@/lib/adminGuard";
import { redirect } from "next/navigation";
import { ServicesScreen } from "../_screens/ServicesScreen";

export const instant = false;

/** ADMIN_V2: lives at /admin/settings/services. Old shell: unchanged. */
export default async function Page() {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 === "on") redirect("/admin/settings/services");
  return <ServicesScreen />;
}

import { requireSuperAdmin } from "@/lib/adminGuard";
import { redirect } from "next/navigation";
import { VoicesScreen } from "../_screens/VoicesScreen";

export const instant = false;

/** ADMIN_V2: lives at /admin/settings/voices. Old shell: unchanged. */
export default async function Page() {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 === "on") redirect("/admin/settings/voices");
  return <VoicesScreen />;
}

import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound } from "next/navigation";
import { PackagesScreen } from "../../_screens/PackagesScreen";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/packages. */
export default async function Page() {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") notFound();
  return <PackagesScreen />;
}

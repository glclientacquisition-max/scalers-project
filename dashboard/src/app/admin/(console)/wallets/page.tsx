import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";

export default async function AdminWalletsPage() {
  await requireSuperAdmin();
  redirect("/admin/businesses");
}

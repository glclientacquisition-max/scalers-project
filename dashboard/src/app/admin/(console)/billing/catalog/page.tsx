import { redirect } from "next/navigation";

export default function AdminBillingCatalogRedirect() {
  redirect("/admin/packages");
}

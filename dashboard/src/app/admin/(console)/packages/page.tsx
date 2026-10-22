import { redirect } from "next/navigation";
import { PackagesScreen } from "../_screens/PackagesScreen";

export const instant = false;

/** ADMIN_V2: lives at /admin/billing/packages. Old shell: unchanged. */
export default async function Page() {
  if (process.env.ADMIN_V2 === "on") redirect("/admin/billing/packages");
  return <PackagesScreen />;
}

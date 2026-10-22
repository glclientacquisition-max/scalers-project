import { redirect } from "next/navigation";
import { ServicesScreen } from "../_screens/ServicesScreen";

export const instant = false;

/** ADMIN_V2: lives at /admin/settings/services. Old shell: unchanged. */
export default async function Page() {
  if (process.env.ADMIN_V2 === "on") redirect("/admin/settings/services");
  return <ServicesScreen />;
}

import { notFound } from "next/navigation";
import { PackagesScreen } from "../../_screens/PackagesScreen";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/packages. */
export default async function Page() {
  if (process.env.ADMIN_V2 !== "on") notFound();
  return <PackagesScreen />;
}

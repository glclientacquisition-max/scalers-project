import { notFound } from "next/navigation";
import { ServicesScreen } from "../../_screens/ServicesScreen";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/platform. */
export default async function Page() {
  if (process.env.ADMIN_V2 !== "on") notFound();
  return <ServicesScreen />;
}

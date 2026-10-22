import { notFound } from "next/navigation";
import { VoicesScreen } from "../../_screens/VoicesScreen";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/voices. */
export default async function Page() {
  if (process.env.ADMIN_V2 !== "on") notFound();
  return <VoicesScreen />;
}

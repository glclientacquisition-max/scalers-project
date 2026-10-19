import { notFound } from "next/navigation";
import { DevPayFixtures } from "./fixtures";

/** Pay page states. DASHBOARD_OPEN=true only. Sample invoice only. */
export default function DevPayPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return <DevPayFixtures />;
}

import { notFound } from "next/navigation";
import { DevPwaStates } from "./DevPwaStates";

/** Local harness for the install card and Phone alerts states (no login). DASHBOARD_OPEN=true only. */
export default async function DevPwaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const { view = "alerts-off" } = await searchParams;
  return <DevPwaStates view={view} />;
}

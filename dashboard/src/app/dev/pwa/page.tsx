import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DevPwaStates } from "./DevPwaStates";

type Props = { searchParams: Promise<{ view?: string }> };

async function DevPwaView({ searchParams }: Props) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const { view = "alerts-off" } = await searchParams;
  return <DevPwaStates view={view} />;
}

/** Local harness for the install card and Phone alerts states (no login). DASHBOARD_OPEN=true only. */
export default function DevPwaPage({ searchParams }: Props) {
  return (
    <Suspense fallback={null}>
      <DevPwaView searchParams={searchParams} />
    </Suspense>
  );
}

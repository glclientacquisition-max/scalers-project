import { notFound } from "next/navigation";
import { UnknownAnswerFixture } from "./UnknownAnswerFixture";

export const instant = false;

/** When unsure line. ?state=edited shows an owner line with its spoken pair. DASHBOARD_OPEN=true only. */
export default async function DevUnknownAnswerPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; pending?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  return <UnknownAnswerFixture edited={sp.state === "edited"} updating={sp.pending === "1"} />;
}

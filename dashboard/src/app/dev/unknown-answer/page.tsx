import { notFound } from "next/navigation";
import { UnknownAnswerFixture } from "./UnknownAnswerFixture";

export const instant = false;

/** When unsure spoken lines. DASHBOARD_OPEN=true only. */
export default async function DevUnknownAnswerPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  return <UnknownAnswerFixture updating={sp.pending === "1"} />;
}

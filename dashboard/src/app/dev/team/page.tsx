import { notFound } from "next/navigation";
import { TeamFixture } from "./TeamFixture";

export const instant = false;

/** Team panel fixture with mock data, for layout screenshots. DASHBOARD_OPEN=true only. */
export default async function DevTeamPage({ searchParams }: { searchParams: Promise<{ full?: string; open?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  return <TeamFixture full={sp.full === "1"} open={sp.open || ""} />;
}

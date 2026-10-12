import { notFound } from "next/navigation";
import { CallInsights } from "@/components/insights/CallInsights";
import { buildCallInsights } from "@/lib/callInsights";
import { fixtureFacts } from "@/lib/callInsightsFixture";

export default async function Page({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const n = Math.max(0, Math.min(200, Number((await searchParams).n ?? 40) || 0));
  return (
    <main className="desk-theme min-h-dvh bg-canvas px-4 py-6">
      <div className="mx-auto max-w-xl">
        <CallInsights insights={buildCallInsights(fixtureFacts(n))} />
      </div>
    </main>
  );
}

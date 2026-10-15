import { notFound } from "next/navigation";
import { StructuredFixture } from "./Fixture";

export const instant = false;

/** Dev-only fixture for the typed-data UI (payments, price checks, category, call correction). */
export default async function DevStructuredPage({ searchParams }: { searchParams: Promise<{ view?: string; vertical?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8">
      <h1 className="mx-auto mb-6 w-full max-w-2xl text-display text-ink">{sp.view?.startsWith("call") ? "Call" : "Settings"}</h1>
      <StructuredFixture view={sp.view || "settings"} vertical={sp.vertical === "home_services" ? "home_services" : "retail"} />
    </main>
  );
}

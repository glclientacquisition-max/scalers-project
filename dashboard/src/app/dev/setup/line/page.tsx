import { notFound } from "next/navigation";
import { LineView } from "@/app/onboarding/line/LineView";
import { emptyCallSetup } from "@/lib/callSetupStore";

export const instant = false;

export default async function DevLinePage({ searchParams }: { searchParams: Promise<{ pending?: string; option?: string; tenant?: string; test?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const option = sp.option === "main" ? "main_number" : sp.option === "forward" ? "forward" : null;
  // ?tenant= keeps fixture states apart in localStorage (each state its own key).
  const tenantId = `dev-tenant${sp.tenant ? `-${sp.tenant.replace(/[^a-z0-9-]/gi, "").slice(0, 24)}` : ""}`;
  // ?test=waiting|missed|works seeds the test step; a teammate's number pre-fills the field.
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const fixture =
    sp.test === "waiting"
      ? { network: "safaricom" as const, test_from: "+254722000111", test_started_at: minsAgo(2) }
      : sp.test === "missed"
        ? { network: "safaricom" as const, test_from: "+254722000111", test_started_at: minsAgo(45) }
        : sp.test === "works"
          ? { network: "safaricom" as const, test_from: "+254722000111", test_started_at: minsAgo(10), tested_at: minsAgo(9), tested_via: "auto" as const }
          : null;
  return (
    <LineView
      testFromSuggestion="+254722000111"
      // Test states render as the account copy (as signed in), so the screen shows the watching copy.
      server={fixture ? { supported: true, setup: { ...emptyCallSetup(), option: "forward", opened_at: minsAgo(60), ...fixture } } : null}
      businessName="Westlands Phones"
      tenantId={tenantId}
      raw={sp.pending === "1" ? "pending" : "+254711082000"}
      initialOption={option}
    />
  );
}

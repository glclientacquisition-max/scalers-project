import { notFound } from "next/navigation";
import { SetupFlow } from "@/app/onboarding/SetupFlow";
import { defaultDraft, emptyRow, stepIndex, type SetupDraft } from "@/lib/setupFlow";

export const instant = false;

/** Setup steps with mock data, for screenshots and axe. DASHBOARD_OPEN=true only. Saving is not wired. */
export default async function DevSetupPage({ searchParams }: { searchParams: Promise<{ step?: string; vertical?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const home = sp.vertical === "home_services";
  const draft: SetupDraft = defaultDraft({ phone: "+254790381872", email: "owner@shop.co.ke" });
  draft.business = { vertical: home ? "home_services" : "retail", landmark: "Opposite Naivas, Westlands", directions: "" };
  draft.catalogue = {
    skipped: false,
    rows: [{ ...emptyRow(home ? "Sofa cleaning" : "Fast charger, 20W"), price: home ? "2500" : "650" }],
  };
  draft.faqs = { skipped: false, items: [{ question: "Do you accept M-Pesa?", answer: "Yes, till 123456." }] };
  const step = sp.step && stepIndex(sp.step) >= 0 ? sp.step : "business";
  return (
    <SetupFlow
      tenantId="dev-tenant"
      userId="dev-user"
      businessName={home ? "Kilimani Cleaners" : "Westlands Phones"}
      initialDraft={draft}
      initialVersion={1}
      furthestStep={5}
      requestedStep={step}
      signOut={<span className="text-meta text-ink-2">Sign out</span>}
    />
  );
}

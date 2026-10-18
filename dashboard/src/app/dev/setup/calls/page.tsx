import { notFound } from "next/navigation";
import { CallsForwardingPanel } from "@/components/CallsForwardingPanel";
import { emptyCallSetup, type CallSetup } from "@/lib/callSetupStore";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";

export const instant = false;

/** Settings > Calls & forwarding fixture: ?state=forward|auto|reaching|main|none|pending. */
export default async function DevCallsSettingsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const state = sp.state || "forward";
  let setup: CallSetup | null = null;
  let firstCallAfterOpenAt: string | null = null;
  let testMatchAt: string | null = null;
  if (state === "forward") {
    setup = { ...emptyCallSetup(), option: "forward", network: "airtel", ring_seconds: 20, opened_at: ago(3), tested_at: ago(2), tested_via: "manual" };
  } else if (state === "auto") {
    setup = { ...emptyCallSetup(), option: "forward", network: "safaricom", choices: ["no_answer", "off"], ring_seconds: 30, opened_at: ago(3), test_from: "+254722000111", test_started_at: ago(1.01) };
    firstCallAfterOpenAt = ago(1);
    testMatchAt = ago(1);
  } else if (state === "reaching") {
    setup = { ...emptyCallSetup(), option: "forward", network: "telkom", opened_at: ago(3) };
    firstCallAfterOpenAt = ago(1);
  } else if (state === "main") {
    setup = { ...emptyCallSetup(), option: "main_number", opened_at: ago(1) };
  }
  const status = resolveCallSetupStatus({
    numberReady: state !== "pending",
    setup,
    activity: { testMatchAt, firstCallAfterOpenAt, lastCallAt: firstCallAfterOpenAt },
    now,
  });
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <h1 className="font-display text-title tracking-tight text-ink">Calls &amp; forwarding</h1>
      <div className="mt-4">
        <CallsForwardingPanel
          tenantId="dev-tenant-calls"
          number={state === "pending" ? null : "0711082000"}
          pretty="+254 711 082 000"
          supported
          setup={setup}
          status={status}
        />
      </div>
    </main>
  );
}

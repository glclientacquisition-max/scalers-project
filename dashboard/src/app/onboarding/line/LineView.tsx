import { BrandWordmark } from "@/components/brand/BrandMark";
import { ButtonLink } from "@/components/ui/Button";
import { formatKenyaNumber, numberPending } from "@/lib/setupFlow";
import { toLocal07 } from "@/lib/callForwarding";
import type { CallSetup, CallSetupOption } from "@/lib/callSetupStore";
import { CallSetupStep } from "./CallSetupStep";
import { PendingNumber } from "./PendingNumber";

/** Number screen from data only (route loads it; /dev/setup/line renders fixtures). */
export function LineView({
  businessName,
  tenantId,
  raw,
  initialOption = null,
  server = null,
  testFromSuggestion = null,
}: {
  businessName: string;
  tenantId: string;
  raw: string | null;
  /** Dev fixture only (/dev/setup/line?option=...). */
  initialOption?: CallSetupOption | null;
  /** Account call setup (tenants.call_setup); null in the dev fixture. */
  server?: { supported: boolean; setup: CallSetup | null } | null;
  /** Teammate's number (+254) to pre-fill the test phone. */
  testFromSuggestion?: string | null;
}) {
  const pending = numberPending(raw);
  const pretty = formatKenyaNumber(raw);
  const local = pending ? null : toLocal07(raw);
  return (
    <main className="min-h-dvh pb-[max(2rem,env(safe-area-inset-bottom))]">
      {/* Same header as the setup steps, so the logo stays put from step 1 to the number. */}
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-3">
          <span aria-hidden className="inline-flex min-h-11 w-[4.5rem] shrink-0" />
          <BrandWordmark href="/home" context="Setup" variant="lockup" priority />
        </div>
      </header>
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <h1 className="text-display text-ink">{businessName} is set up</h1>

        {pending ? (
          <PendingNumber tenantId={tenantId} />
        ) : (
          <section aria-labelledby="line-label" className="mt-6 rounded-2xl bg-surface p-5">
            <h2 id="line-label" className="text-meta font-medium text-ink-2">
              Your Business Assistant&apos;s number
            </h2>
            <p className="mt-1 text-display font-semibold tabular-nums text-ink">{pretty}</p>
            <p className="mt-3 text-body text-ink-2">
              Call it from your phone to hear how it answers. Then set up your calls below.
            </p>
            <a
              href={`tel:${String(raw).replace(/\s/g, "")}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 text-body font-medium text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Call {pretty}
            </a>
          </section>
        )}

        {local ? <CallSetupStep tenantId={tenantId} number={local} pretty={pretty} initialOption={initialOption} server={server} testFromSuggestion={testFromSuggestion} /> : null}

        <ButtonLink href="/home" prefetch variant={local ? "tonal" : "primary"} size="lg" block className="mt-8">
          Go to Overview
        </ButtonLink>
        <p className="mt-3 text-center text-meta text-ink-2">You can change any answer later in Settings.</p>
      </div>
    </main>
  );
}

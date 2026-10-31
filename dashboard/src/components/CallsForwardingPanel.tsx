"use client";

import { useEffect, useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { CopyCode } from "@/components/CopyCode";
import {
  ALL_OFF_CODE,
  callsReachLine,
  type ForwardChoice,
  NETWORK_LABEL,
  dialHref,
  forwardOnCode,
  phoneFromUserAgent,
  ringSeconds,
  type PhoneKind,
} from "@/lib/callForwarding";
import { browserCallSetupStore, type CallSetup } from "@/lib/callSetupStore";
import { testedLine, type CallSetupStatus } from "@/lib/callSetupStatus";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
      <dt className="shrink-0 text-meta text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right text-body font-medium text-ink">{children}</dd>
    </div>
  );
}

/** Short labels so the Copy and Dial row fits at 360. */
const SHORT_LABEL: Record<ForwardChoice, string> = {
  all: "No answer, busy or phone off",
  no_answer: "When I don't answer",
  busy: "When I'm busy",
  off: "When my phone is off",
};

/**
 * Settings > Calls & forwarding. Read-only summary of the account's call setup,
 * "Change setup" (opens the setup step) and the code that turns every forward off.
 * Before tenants.call_setup exists (`supported` false) it reads this browser's copy.
 */
export function CallsForwardingPanel({
  tenantId,
  number,
  pretty,
  supported,
  setup: serverSetup,
  status,
}: {
  tenantId: string;
  /** Local 07 form, or null while the number is pending. */
  number: string | null;
  pretty: string;
  supported: boolean;
  setup: CallSetup | null;
  status: Pick<CallSetupStatus, "tested" | "testedVia" | "testedAt" | "testFrom" | "reaching" | "option">;
}) {
  const [setup, setSetup] = useState<CallSetup | null>(serverSetup);
  const [phone, setPhone] = useState<PhoneKind | null>(null);
  const [stopOpen, setStopOpen] = useState(false);

  useEffect(() => {
    const local = supported ? null : browserCallSetupStore().load(tenantId);
    if (local) setSetup(local);
    setPhone((local ?? serverSetup)?.phone ?? phoneFromUserAgent(navigator.userAgent));
  }, [supported, tenantId, serverSetup]);

  const localTested = !supported && setup?.tested_at
    ? { tested: true, testedVia: "manual" as const, testedAt: setup.tested_at, testFrom: null, reaching: false }
    : null;
  const line = testedLine({ ...(localTested ?? status), option: setup?.option ?? status.option });
  const option = setup?.option ?? null;
  const ring = ringSeconds(setup?.ring_seconds);
  const choices = setup?.choices?.length ? setup.choices : ["all" as const];

  if (!number) {
    return (
      <p className="rounded-2xl bg-surface p-4 text-body text-ink-2">
        Your number is on its way. Call setup opens here once it&apos;s ready.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <section aria-label="Current setup" className="rounded-2xl border border-hairline bg-surface px-4 py-1">
        <dl>
          <Row label="Calls">{callsReachLine(option, setup?.network)}</Row>
          <Row label="Business Assistant's number">
            <span className="tabular-nums">{pretty}</span>
          </Row>
          {option === "forward" ? (
            <>
              <Row label="Network">{setup?.network ? NETWORK_LABEL[setup.network] : "Not picked"}</Row>
              <Row label="Rings first">{ring} seconds</Row>
            </>
          ) : null}
          <Row label="Status">
            <span className={line.ok ? "text-ok" : "text-ink"}>{line.title}</span>
            {line.detail ? <span className="block text-meta font-normal text-ink-2">{line.detail}</span> : null}
          </Row>
        </dl>
      </section>

      {option === "forward" ? (
        <section aria-labelledby="calls-codes" className="grid gap-2">
          <h3 id="calls-codes" className="text-body font-semibold text-ink">
            {choices.length > 1 ? "Your codes" : "Your code"}
          </h3>
          {choices.map((choice) => {
            const code = forwardOnCode(choice, number, ring);
            return <CopyCode key={choice} label={SHORT_LABEL[choice]} code={code} dial={dialHref(code, phone)} size="sm" />;
          })}
        </section>
      ) : null}

      <ButtonLink href="/onboarding/line" variant="tonal" block>
        Change setup
      </ButtonLink>

      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 text-left"
        onClick={() => setStopOpen(true)}
      >
        <span className="text-body font-medium text-ink">Stop forwarding</span>
        <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink-3" aria-hidden="true" />
      </button>
      <Sheet open={stopOpen} onOpenChange={setStopOpen} title="Stop forwarding">
        <div className="grid gap-3">
          <CopyCode label="Dial on your business line" code={ALL_OFF_CODE} dial={dialHref(ALL_OFF_CODE, phone)} />
          <p className="text-body text-ink-2">Your phone goes back to normal. You can set it up again any time.</p>
        </div>
      </Sheet>
    </div>
  );
}

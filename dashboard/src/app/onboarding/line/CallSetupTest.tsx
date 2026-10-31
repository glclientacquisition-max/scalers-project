"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { CopyCode } from "@/components/CopyCode";
import {
  CHECK_CODES,
  dialHref,
  forwardOnCode,
  kenyaMobileDisplay,
  networkHelpLine,
  noAnswerFallbackCodes,
  toKenyaMobileE164,
  type ForwardChoice,
  type NetworkId,
  type PhoneKind,
  type RingSeconds,
} from "@/lib/callForwarding";
import {
  TEST_WINDOW_MINUTES,
  showFixChecklist,
  showWinMoment,
  testWindow,
  worksTitle,
} from "@/lib/callSetupStatus";
import { testIncludesBusy, type CallSetup } from "@/lib/callSetupStore";
import { checkCallSetupTestAction } from "./callSetupActions";
import { TestWinMoment } from "./TestWinMoment";

const cardBase = "rounded-2xl border border-hairline bg-surface p-4";
const POLL_MS = 10_000;

const summaryClass =
  "flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-body font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden";

/**
 * "Test it": the owner names the phone they'll test from and starts a 30-minute window.
 * Only a call from that phone in the window proves forwarding (checked on the server);
 * "I tested it" stays as the manual way. If nothing arrives, or they say it didn't
 * work, a short checklist shows in a fixed order.
 */
export function CallSetupTest({
  tenantId,
  setup,
  number,
  pretty,
  ring,
  phone,
  suggestion,
  watch,
  onSave,
  onLocal,
}: {
  tenantId: string;
  setup: CallSetup;
  number: string;
  pretty: string;
  ring: RingSeconds;
  phone: PhoneKind | null;
  /** Teammate's number (+254) to pre-fill, or null for an empty field. */
  suggestion: string | null;
  /** True when the account copy exists, so the server can spot the test call. */
  watch: boolean;
  onSave: (patch: Partial<CallSetup>) => void;
  /** Already saved on the server: update the screen only. */
  onLocal: (patch: Partial<CallSetup>) => void;
}) {
  const option = setup.option;
  const tested = Boolean(setup.tested_at);
  const [input, setInput] = useState(() => kenyaMobileDisplay(setup.test_from ?? suggestion));
  const [error, setError] = useState<string | null>(null);
  const [saidNo, setSaidNo] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [winCallId, setWinCallId] = useState<string | null>(null);
  const win = testWindow(setup, now);
  const waiting = !tested && win === "open";

  // Tick so the window can close on screen; poll the server while it's open.
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const tick = async () => {
      setNow(Date.now());
      if (!watch) return;
      const res = await checkCallSetupTestAction(tenantId).catch(() => null);
      if (!stop && res?.ok && res.matchedAt) {
        setWinCallId(res.matchedCallId ?? null);
        onLocal({ tested_at: res.matchedAt, tested_via: "auto" });
      }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
    // onLocal is a fresh function each render; the window and test phone drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, watch, tenantId, setup.test_started_at]);

  function start() {
    const e164 = toKenyaMobileE164(input);
    if (!e164) {
      setError("Enter a Kenyan mobile number, like 0712 345 678.");
      return;
    }
    setError(null);
    setSaidNo(false);
    setInput(kenyaMobileDisplay(e164));
    const at = new Date();
    setNow(at.getTime());
    onSave({ test_from: e164, test_started_at: at.toISOString() });
  }

  const from = kenyaMobileDisplay(setup.test_from);
  const checklist = option === "forward" && showFixChecklist({ tested, saidNo, window: win });
  const missed = !tested && win === "over";

  if (tested && showWinMoment(setup)) {
    return (
      <TestWinMoment
        from={from}
        callId={winCallId}
        onSeen={() => onSave({ auto_seen_at: new Date().toISOString() })}
      />
    );
  }

  if (tested) {
    const auto = setup.tested_via === "auto";
    return (
      <div className={cardBase} role="status">
        <p className="text-body font-semibold text-ok">{auto ? worksTitle(option) : "You're all set."}</p>
        <p className="mt-1 text-body text-ink-2">
          {auto && from ? `We saw your test call from ${from}. ` : ""}
          {option === "forward" ? "Missed calls now go to your Business Assistant." : `Calls to ${pretty} go to your Business Assistant.`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="mt-2 -ml-4"
          onClick={() => onSave({ tested_at: null, tested_via: null, test_started_at: null })}
        >
          Test again
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className={cardBase}>
        {option === "forward" ? (
          <p className="text-body text-ink-2">
            Ask a teammate to call your business number. Let it ring and don&apos;t pick up. After about {ring} seconds your
            assistant should answer with your business name.
            {testIncludesBusy(setup.choices) ? " Then ask them to call again and press the red button." : ""}
          </p>
        ) : (
          <p className="text-body text-ink-2">
            Call <span className="font-semibold tabular-nums text-ink">{pretty}</span> and listen to your Business Assistant.
          </p>
        )}

        <TextField
          id="call-test-from"
          className="mt-3"
          label="Which phone will you test from?"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="0712 345 678"
          value={input}
          readOnly={waiting}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          error={error}
          hint={option === "forward" ? "Not your business line. A teammate's phone works." : "The phone you'll call from."}
        />

        {waiting ? (
          <p role="status" aria-live="polite" className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-meta text-ink-2">
            {watch ? (
              <>
                Waiting for a call from <span className="font-semibold tabular-nums text-ink">{from}</span>. We&apos;ll
                look for it for {TEST_WINDOW_MINUTES} minutes.
              </>
            ) : (
              <>
                Call now from <span className="font-semibold tabular-nums text-ink">{from}</span>, then tap I tested it.
              </>
            )}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {waiting || checklist ? null : (
            <Button type="button" variant="primary" onClick={start}>
              {missed ? "Start again" : "Start test"}
            </Button>
          )}
          <Button
            type="button"
            variant={waiting ? "primary" : "tonal"}
            onClick={() => onSave({ tested_at: new Date().toISOString(), tested_via: "manual" })}
          >
            I tested it
          </Button>
          <Button type="button" variant="ghost" aria-expanded={saidNo} onClick={() => setSaidNo(true)}>
            It didn&apos;t work
          </Button>
        </div>
      </div>

      {option === "main_number" && (saidNo || missed) ? (
        <p role="status" className="mt-3 rounded-2xl border border-hairline bg-surface px-4 py-3 text-meta text-ink-2">
          <span className="font-semibold text-ink">No answer? </span>
          Check you dialled {pretty}, wait a minute and call again. If your Business Assistant still doesn&apos;t answer, reply to any
          Scalers email and we&apos;ll check your line.
        </p>
      ) : null}

      {checklist ? (
        <FixChecklist
          heading={missed && !saidNo && from ? `No call from ${from} yet` : "Let's fix it"}
          choices={setup.choices}
          network={setup.network}
          number={number}
          ring={ring}
          phone={phone}
          retryLabel={missed ? "Start the test again" : "Start the test"}
          onRetry={start}
        />
      ) : null}
    </>
  );
}

function FixChecklist({
  heading,
  choices,
  network,
  number,
  ring,
  phone,
  retryLabel,
  onRetry,
}: {
  heading: string;
  retryLabel: string;
  choices: readonly ForwardChoice[];
  network: NetworkId | null;
  number: string;
  ring: RingSeconds;
  phone: PhoneKind | null;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="call-fix" className={`${cardBase} mt-3`} data-testid="call-fix-checklist">
      <h4 id="call-fix" className="text-body font-semibold text-ink">
        {heading}
      </h4>
      <ol className="mt-2 grid list-decimal gap-3 pl-5 text-meta text-ink-2 marker:font-semibold marker:text-ink">
        <li>
          <span className="font-semibold text-ink">Top up airtime or buy a minutes bundle on your business line.</span>{" "}
          Forwarding uses your own airtime.
        </li>
        <li>
          Check you dialled the code on the business SIM. Two SIMs? Pick the business SIM when your phone asks.
        </li>
        <li>
          Dial the code again, then check it&apos;s on.
          <div className="mt-2 grid gap-2">
            {choices.map((choice) => {
              const code = forwardOnCode(choice, number, ring);
              return <CopyCode key={choice} label="Your code" code={code} dial={dialHref(code, phone)} size="sm" />;
            })}
          </div>
          <p className="mt-2">Check with these. Your phone shows the number calls go to.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CHECK_CODES.map((code) => {
              const href = dialHref(code, phone);
              const chip = "inline-flex min-h-11 items-center rounded-lg bg-surface-2 px-3 font-mono text-body text-ink";
              return href ? (
                <a key={code} href={href} translate="no" className={`${chip} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}>
                  {code}
                </a>
              ) : (
                <code key={code} translate="no" className={chip}>
                  {code}
                </code>
              );
            })}
          </div>
          {network === "telkom" ? (
            <p className="mt-2">We haven&apos;t tested Telkom yet. If the check shows nothing, ask Telkom customer care.</p>
          ) : null}
        </li>
        <li>
          Try again.
          <div className="mt-2">
            <Button type="button" variant="primary" size="md" onClick={onRetry}>
              {retryLabel}
            </Button>
          </div>
        </li>
      </ol>

      <details className="group mt-3 rounded-xl border border-hairline">
        <summary className={summaryClass}>
          <span aria-hidden className="inline-block w-3 text-center text-ink-3 transition-transform duration-fast group-open:rotate-90">
            ›
          </span>
          More help
        </summary>
        <div className="grid gap-4 px-4 pb-4 text-meta text-ink-2">
          <div>
            <p className="font-semibold text-ink">&quot;Connection problem&quot; or &quot;Invalid code&quot;?</p>
            <p className="mt-0.5">Use Other choices instead. If &quot;When I don&apos;t answer&quot; still fails, try these in turn:</p>
            {noAnswerFallbackCodes(number, ring).map((code, i) => (
              <CopyCode
                key={code}
                className="mt-2"
                label={i === 0 ? "Try this first" : "Then this (your network's ring time)"}
                code={code}
                dial={dialHref(code, phone)}
                size="sm"
              />
            ))}
          </div>
          {phone !== "iphone" ? (
            <p>
              <span className="font-semibold text-ink">Still an error on Android? </span>
              Turn off VoLTE or 4G calling for the business SIM, dial again, then turn it back on. Or open Phone, three
              dots, Settings, Calls, Call forwarding. Fill When busy, When unanswered and When unreachable with {number}.
              Leave Always forward off.
            </p>
          ) : null}
          <p>
            <span className="font-semibold text-ink">You used voicemail before? </span>
            These codes replace it, so missed calls go to your Business Assistant instead.
          </p>
          <p>
            <span className="font-semibold text-ink">Still stuck? </span>
            {networkHelpLine(network)} Or reply to any Scalers email and we&apos;ll help.
          </p>
        </div>
      </details>
    </section>
  );
}

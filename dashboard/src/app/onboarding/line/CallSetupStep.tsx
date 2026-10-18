"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/Segmented";
import { CopyCode } from "@/components/CopyCode";
import { cx } from "@/lib/cx";
import {
  ALL_OFF_CODE,
  CHECK_CODES,
  CHOICE_COPY,
  NETWORKS,
  NETWORK_LABEL,
  RING_OPTIONS,
  SEPARATE_CHOICES,
  dialHref,
  forwardOffCode,
  forwardOnCode,
  networkCodeNote,
  networkHelpLine,
  noAnswerFallbackCodes,
  phoneFromUserAgent,
  ringHelp,
  ringSeconds,
  type ForwardChoice,
  type NetworkId,
  type PhoneKind,
} from "@/lib/callForwarding";
import {
  browserCallSetupStore,
  emptyCallSetup,
  testIncludesBusy,
  type CallSetup,
  type CallSetupOption,
} from "@/lib/callSetupStore";

const AIRTIME_NOTE =
  "Forwarding needs airtime, minutes or a talk-time bundle on your business line. Your network charges each forwarded call to you at your normal call rate. With no airtime, calls may not come through.";

const cardBase = "rounded-2xl border border-hairline bg-surface p-4";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6" aria-labelledby={`call-step-${n}`}>
      <h3 id={`call-step-${n}`} className="flex items-baseline gap-2 text-body font-semibold text-ink">
        <span className="tabular-nums text-ink-3">{n}</span>
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function AirtimeNote() {
  return (
    <p className="rounded-xl bg-attention-tonal px-3 py-2 text-meta text-ink" role="note">
      <span className="font-semibold text-attention">Needs airtime. </span>
      {AIRTIME_NOTE}
    </p>
  );
}

function OptionCard({
  active,
  title,
  line,
  badge,
  onSelect,
}: {
  active: boolean;
  title: string;
  line: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cx(
        "flex min-h-11 w-full flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        active ? "border-accent bg-accent/[0.06]" : "border-hairline bg-surface hover:bg-surface-2",
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="text-body font-semibold text-ink">{title}</span>
        {badge ? (
          <span className="shrink-0 rounded-full bg-ok-tonal px-2 py-0.5 text-meta font-medium text-ok">{badge}</span>
        ) : null}
      </span>
      <span className="text-meta text-ink-2">{line}</span>
    </button>
  );
}

function ChoiceCard({
  choice,
  number,
  ring,
  phone,
  picked,
  recommended,
  onToggle,
}: {
  choice: ForwardChoice;
  number: string;
  ring: (typeof RING_OPTIONS)[number];
  phone: PhoneKind | null;
  picked: boolean;
  recommended?: boolean;
  onToggle: () => void;
}) {
  const copy = CHOICE_COPY[choice];
  const on = forwardOnCode(choice, number, ring);
  const off = forwardOffCode(choice);
  return (
    <article
      className={
        recommended
          ? "rounded-2xl border-2 border-accent bg-accent/[0.06] p-4"
          : cx("rounded-2xl border bg-surface p-4", picked ? "border-accent" : "border-hairline")
      }
      data-choice={choice}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {recommended ? (
            <span className="mb-1 inline-block rounded-full bg-ok-tonal px-2 py-0.5 text-meta font-medium text-ok">
              Recommended
            </span>
          ) : null}
          <h4 className="text-body font-semibold text-ink">{copy.title}</h4>
          <p className="mt-0.5 text-meta text-ink-2">{copy.line(ring)}</p>
        </div>
        {recommended ? null : (
          <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-meta font-medium text-ink-2">
            <input
              type="checkbox"
              checked={picked}
              onChange={onToggle}
              className="h-5 w-5 accent-accent"
            />
            Using
          </label>
        )}
      </div>
      <CopyCode className="mt-3" label="Turn on" code={on} dial={dialHref(on, phone)} />
      {recommended && !picked ? (
        <Button type="button" variant="tonal" size="md" className="mt-3" onClick={onToggle}>
          Use this instead
        </Button>
      ) : null}
      <CopyCode className="mt-3" label="Turn off" code={off} dial={dialHref(off, phone)} size="sm" />
    </article>
  );
}

export function CallSetupStep({
  tenantId,
  number,
  pretty,
  initialOption = null,
}: {
  tenantId: string;
  /** Scalers number in local 07 form, digits only. */
  number: string;
  pretty: string;
  /** Dev fixture only: open on an option when nothing is saved. */
  initialOption?: CallSetupOption | null;
}) {
  const store = useRef(browserCallSetupStore());
  const [setup, setSetup] = useState<CallSetup>(() => ({ ...emptyCallSetup(), option: initialOption }));
  const [loaded, setLoaded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const saved = store.current.load(tenantId);
    const phone = saved.phone ?? phoneFromUserAgent(navigator.userAgent);
    setSetup({ ...saved, option: saved.option ?? initialOption, phone });
    setLoaded(true);
  }, [tenantId, initialOption]);

  function update(patch: Partial<CallSetup>) {
    setSetup((prev) => {
      const next = { ...prev, ...patch };
      store.current.save(tenantId, next);
      return next;
    });
  }

  const ring = ringSeconds(setup.ring_seconds);
  const phone = loaded ? setup.phone : null;
  const usesAll = setup.choices.includes("all");

  function toggle(choice: ForwardChoice) {
    if (choice === "all") {
      update({ choices: usesAll ? ["no_answer", "busy", "off"] : ["all"] });
      return;
    }
    const current = setup.choices.filter((c) => c !== "all");
    const next = current.includes(choice) ? current.filter((c) => c !== choice) : [...current, choice];
    update({ choices: next.length ? next : ["all"] });
  }

  const tested = Boolean(setup.tested_at);
  const option = setup.option;
  let stepN = 1;

  return (
    <section aria-labelledby="calls-setup" className="mt-8">
      <h2 id="calls-setup" className="text-title text-ink">
        Set up your calls
      </h2>
      <p className="mt-1 text-body text-ink-2">Pick how callers reach your assistant. You can do both.</p>

      <div role="radiogroup" aria-label="How callers reach your assistant" className="mt-3 grid gap-2">
        <OptionCard
          active={option === "main_number"}
          title="Use your Scalers number as your business number"
          line="Nothing to dial and no airtime needed."
          badge="Simplest"
          onSelect={() => update({ option: "main_number" })}
        />
        <OptionCard
          active={option === "forward"}
          title="Keep your number and forward calls"
          line="Your phone rings first. If you don't pick up, your assistant answers."
          onSelect={() => update({ option: "forward" })}
        />
      </div>

      {option === "main_number" ? (
        <Step n={stepN++} title="Share your Scalers number">
          <div className={cardBase}>
            <p className="text-body text-ink-2">
              Put <span className="font-semibold tabular-nums text-ink">{pretty}</span> on your website, Google profile,
              business cards and WhatsApp. Every call goes straight to your assistant.
            </p>
            <CopyCode className="mt-3" label="Your number" code={number} dial={`tel:${number}`} />
            <p className="mt-3 text-meta text-ink-2">
              Your assistant answers every call. It can&apos;t put a caller through to you during the call. When someone
              needs you, it takes their name and what they need, sends you a message, and saves it in your Desk.
            </p>
          </div>
        </Step>
      ) : null}

      {option === "forward" ? (
        <>
          <div className="mt-4">
            <AirtimeNote />
          </div>

          <Step n={stepN++} title="Your network and phone">
            <div className="grid gap-2">
              <SegmentedControl
                label="Network"
                value={setup.network ?? ""}
                onChange={(value) => update({ network: value as NetworkId })}
                items={NETWORKS.map((id) => ({ value: id, label: NETWORK_LABEL[id] }))}
                className="w-full"
              />
              <SegmentedControl
                label="Phone"
                value={phone ?? ""}
                onChange={(value) => update({ phone: value as PhoneKind })}
                items={[
                  { value: "android", label: "Android" },
                  { value: "iphone", label: "iPhone" },
                ]}
                className="w-full"
              />
            </div>
            <p className="mt-2 text-meta text-ink-2" aria-live="polite">
              {networkCodeNote(setup.network)}
            </p>
            {phone === "iphone" ? (
              <ul className="mt-2 grid gap-1 text-meta text-ink-2">
                <li>iPhone blocks links that turn on call forwarding, so type the code in Phone, then Keypad.</li>
                <li>Don&apos;t use the Call Forwarding switch in iPhone Settings. It sends every call away.</li>
                <li>Two lines? Tap the line name at the top and pick your business line.</li>
              </ul>
            ) : phone === "android" ? (
              <p className="mt-2 text-meta text-ink-2">
                Tap Dial on the phone with your business SIM, or type the code. Two SIMs? Choose the business SIM when asked.
              </p>
            ) : null}
          </Step>

          <Step n={stepN++} title="How long your phone rings first">
            <SegmentedControl
              label="Ring time"
              value={String(ring)}
              onChange={(value) => update({ ring_seconds: ringSeconds(value) })}
              items={RING_OPTIONS.map((s) => ({ value: String(s), label: s === 20 ? `${s} sec · best` : `${s} sec` }))}
              className="w-full"
            />
            <p className="mt-2 text-meta text-ink-2" aria-live="polite">
              {ringHelp(ring)} {ring === 20 ? "That's about 4 or 5 rings. " : ""}To change it later, dial the code again.
            </p>
          </Step>

          <Step n={stepN++} title="Dial the code">
            <div className="grid gap-3">
              <p className="text-body text-ink-2">
                On the phone with your business SIM, dial the code, press call, and wait for the message saying it&apos;s
                turned on. Then tap OK.
              </p>
              <p className="text-meta text-ink-2">
                <span className="font-semibold text-attention">Airtime first. </span>
                Check there&apos;s airtime, minutes or a talk-time bundle on that line before you dial.
              </p>
              <ChoiceCard
                choice="all"
                number={number}
                ring={ring}
                phone={phone}
                picked={usesAll}
                recommended
                onToggle={() => toggle("all")}
              />
              <details className="group rounded-2xl border border-hairline bg-surface" open={!usesAll || undefined}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-body font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="inline-block w-3 text-center text-ink-3 transition-transform duration-fast group-open:rotate-90">
                    ›
                  </span>
                  Other choices
                  <span className="text-meta font-normal text-ink-2">Pick one or more</span>
                </summary>
                <div className="grid gap-3 px-3 pb-3">
                  {SEPARATE_CHOICES.map((choice) => (
                    <ChoiceCard
                      key={choice}
                      choice={choice}
                      number={number}
                      ring={ring}
                      phone={phone}
                      picked={!usesAll && setup.choices.includes(choice)}
                      onToggle={() => toggle(choice)}
                    />
                  ))}
                </div>
              </details>
            </div>
          </Step>
        </>
      ) : null}

      {option ? (
        <Step n={stepN++} title="Test it">
          <div className={cardBase}>
            {tested ? (
              <div role="status">
                <p className="text-body font-semibold text-ok">You&apos;re all set.</p>
                <p className="mt-1 text-body text-ink-2">
                  {option === "forward"
                    ? "Missed calls now go to your assistant."
                    : `Calls to ${pretty} go to your assistant.`}
                </p>
                <Button type="button" variant="ghost" size="md" className="mt-2 -ml-4" onClick={() => update({ tested_at: null })}>
                  Test again
                </Button>
              </div>
            ) : (
              <>
                {option === "forward" ? (
                  <p className="text-body text-ink-2">
                    Ask a friend to call your business number. Let it ring and don&apos;t pick up. After about {ring}{" "}
                    seconds your assistant should answer with your business name.
                    {testIncludesBusy(setup.choices) ? " Then ask them to call again and press the red button." : ""}
                  </p>
                ) : (
                  <p className="text-body text-ink-2">
                    Call <span className="font-semibold tabular-nums text-ink">{pretty}</span> from your phone and listen
                    to your assistant.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="primary" onClick={() => update({ tested_at: new Date().toISOString() })}>
                    I tested it
                  </Button>
                  <Button type="button" variant="ghost" aria-expanded={helpOpen} onClick={() => setHelpOpen(true)}>
                    It didn&apos;t work
                  </Button>
                </div>
              </>
            )}
          </div>

          {option === "main_number" && helpOpen && !tested ? (
            <p role="status" className="mt-3 rounded-2xl border border-hairline bg-surface px-4 py-3 text-meta text-ink-2">
              <span className="font-semibold text-ink">No answer? </span>
              Check you dialled {pretty}, wait a minute and call again. If your assistant still doesn&apos;t answer, reply
              to any Scalers email and we&apos;ll check your line.
            </p>
          ) : null}

          {option === "forward" ? (
            <details
              className="group mt-3 rounded-2xl border border-hairline bg-surface"
              open={helpOpen || undefined}
              onToggle={(event) => setHelpOpen((event.target as HTMLDetailsElement).open)}
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-body font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="inline-block w-3 text-center text-ink-3 transition-transform duration-fast group-open:rotate-90">
                  ›
                </span>
                If it didn&apos;t work
              </summary>
              <div className="grid gap-4 px-4 pb-4 text-meta text-ink-2">
                <AirtimeNote />
                <div>
                  <p className="font-semibold text-ink">&quot;Connection problem&quot; or &quot;Invalid code&quot;?</p>
                  <p className="mt-0.5">
                    Use Other choices instead. If &quot;When I don&apos;t answer&quot; still fails, try these in turn:
                  </p>
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
                    Turn off VoLTE or 4G calling for the business SIM, dial again, then turn it back on. Or open Phone,
                    three dots, Settings, Calls, Call forwarding. Fill When busy, When unanswered and When unreachable
                    with {number}. Leave Always forward off.
                  </p>
                ) : null}
                <p>
                  <span className="font-semibold text-ink">You used voicemail before? </span>
                  These codes replace it, so missed calls go to your assistant instead.
                </p>
                <div>
                  <p className="font-semibold text-ink">Check what&apos;s on</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {CHECK_CODES.map((code) => (
                      <code key={code} translate="no" className="rounded-lg bg-surface-2 px-2 py-1 font-mono text-body text-ink">
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
                <p>
                  <span className="font-semibold text-ink">Still stuck? </span>
                  {networkHelpLine(setup.network)} Or reply to any Scalers email and we&apos;ll help.
                </p>
              </div>
            </details>
          ) : null}
        </Step>
      ) : null}

      {option === "forward" ? (
        <Step n={stepN++} title="Turn everything off">
          <div className={cardBase}>
            <CopyCode label="One code turns off every forward" code={ALL_OFF_CODE} dial={dialHref(ALL_OFF_CODE, phone)} />
            <p className="mt-2 text-meta text-ink-2">
              Your phone goes back to normal. Use it too if your phone stops ringing at all, then set up again.
            </p>
          </div>
        </Step>
      ) : null}
    </section>
  );
}

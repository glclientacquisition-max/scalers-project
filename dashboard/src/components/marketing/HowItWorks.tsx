import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { brandAssets } from "@/components/brand/assets";

const STEPS = [
  "You set the business in the Desk: who you are, hours, services, and the answers.",
  "The assistant takes the call.",
  "You get SMS, WhatsApp, or email, then work it in the inbox: call back, WhatsApp, or an SMS you approve.",
] as const;

const DESK_FIELDS = [
  { label: "Who you are", beat: "hiw-field-1" },
  { label: "Hours", beat: "hiw-field-2" },
  { label: "Services", beat: "hiw-field-3" },
  { label: "Answers", beat: "hiw-field-4" },
] as const;

const USAGE_ROWS = ["Minutes", "SMS", "Email", "WhatsApp"] as const;
const RATE_ROWS = ["Calls", "SMS", "Email", "WhatsApp"] as const;

function Mark({ className }: { className: string }) {
  return (
    <Image
      src={brandAssets.iconTransparent}
      alt=""
      width={28}
      height={28}
      className={className}
    />
  );
}

function FrameShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface" aria-hidden>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Mark className="h-5 w-5 object-contain" />
        <p className="text-sm font-medium text-ink">{title}</p>
      </div>
      {children}
    </div>
  );
}

function DeskFrame() {
  return (
    <FrameShell title="Desk">
      <div className="grid grid-cols-[6.75rem_1fr]">
        <ul className="border-r border-line py-2 text-xs text-ink-soft">
          <li className="px-2.5 py-1.5">Identity</li>
          <li className="border-l-2 border-accent bg-accent-tonal px-2 py-1.5 font-medium text-ink">
            Hours
          </li>
          <li className="px-2.5 py-1.5">Services</li>
          <li className="px-2.5 py-1.5">Answers</li>
        </ul>
        <ul className="space-y-3 p-3">
          {DESK_FIELDS.map((field) => (
            <li key={field.label} className={field.beat}>
              <p className="text-caption font-medium text-ink-soft">{field.label}</p>
              <div className="mt-1.5 h-2 rounded-full bg-surface-2" />
            </li>
          ))}
        </ul>
      </div>
    </FrameShell>
  );
}

function PhoneFrame() {
  return (
    <div className="mx-auto w-[12.5rem]" aria-hidden>
      <div className="rounded-[1.85rem] bg-brand-900 p-2 shadow-[0_18px_40px_-24px_rgb(10_25_47/0.65)]">
        <div className="relative h-64 overflow-hidden rounded-[1.4rem] bg-gradient-to-b from-brand-800 to-brand-900 text-white">
          <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/30" />
          <div className="hiw-incoming absolute inset-0 flex flex-col items-center justify-center px-4">
            <p className="text-caption font-medium uppercase tracking-wide text-sky-100/80">
              Incoming
            </p>
            <p className="mt-1 font-display text-xl">Client</p>
            <span className="hiw-ring mt-5 h-14 w-14 rounded-full border border-white/70" />
          </div>
          <div className="hiw-answered absolute inset-0 flex flex-col items-center justify-center px-4">
            <Mark className="h-10 w-10 object-contain" />
            <p className="mt-3 font-display text-lg">Call assistant</p>
            <p className="mt-1 text-caption text-sky-100/75">Answered</p>
            <div className="mt-5 flex h-8 items-end gap-1">
              {["a", "b", "a", "b", "a", "b", "a"].map((kind, i) => (
                <span
                  key={i}
                  className={`hiw-wave inline-block w-1 rounded-full bg-white/85 ${kind === "a" ? "hiw-wave-a h-7" : "hiw-wave-b h-5"}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InboxFrame() {
  return (
    <FrameShell title="Inbox">
      <div className="space-y-2 border-b border-line px-3 py-2.5">
        <p className="hiw-search rounded-lg border border-line px-2 py-1 text-caption text-ink-soft">
          Search
        </p>
        <ul className="hiw-filter flex flex-wrap gap-1.5">
          <li className="rounded-full bg-accent-tonal px-2 py-0.5 text-caption font-medium text-accent">
            Needs you
          </li>
          <li className="rounded-full border border-line px-2 py-0.5 text-caption font-medium text-ink">
            Missed
          </li>
          <li className="rounded-full border border-line px-2 py-0.5 text-caption font-medium text-ink">
            Answered
          </li>
        </ul>
      </div>
      <div className="hiw-lead flex items-start gap-2 px-3 py-2.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
        <div>
          <p className="text-sm font-medium text-ink">Client</p>
          <p className="text-xs text-ink-soft">Needs you</p>
        </div>
      </div>
      <div className="hiw-missed flex items-start gap-2 border-t border-line px-3 py-2.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-attention" />
        <div>
          <p className="text-sm font-medium text-ink">Client</p>
          <p className="text-xs text-ink-soft">Missed</p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2.5">
        <li className="hiw-ch-1 rounded-full border border-line px-2 py-0.5 text-caption font-medium text-ink">
          SMS
        </li>
        <li className="hiw-ch-2 rounded-full bg-whatsapp/15 px-2 py-0.5 text-caption font-medium text-whatsapp-deep">
          WhatsApp
        </li>
        <li className="hiw-ch-3 rounded-full border border-line px-2 py-0.5 text-caption font-medium text-ink">
          Email
        </li>
      </ul>
      <div className="hiw-actions flex flex-wrap gap-2 border-t border-line px-3 py-2.5">
        <span className="rounded-lg border border-ok/40 bg-ok-soft px-2 py-1 text-caption font-medium text-ok">
          Mark done
        </span>
        <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium text-ink">
          Call
        </span>
        <span className="rounded-lg bg-whatsapp/15 px-2 py-1 text-caption font-medium text-whatsapp-deep">
          WhatsApp
        </span>
        <span className="rounded-lg bg-accent-tonal px-2 py-1 text-caption font-medium text-accent">
          Send SMS
        </span>
      </div>
    </FrameShell>
  );
}

function ContactsFrame() {
  return (
    <div className="hiw-contact">
      <FrameShell title="Contacts">
        <p className="border-b border-line px-3 py-2 text-caption text-ink-soft">Name or number</p>
        <div className="px-3 py-2.5">
          <p className="text-sm font-medium text-ink">Client</p>
          <p className="mt-2 text-caption font-medium text-ink-soft">History</p>
          <ul className="mt-1.5 space-y-1.5">
            <li className="hiw-history-1 flex items-center justify-between gap-3 text-sm text-ink">
              <span>Call</span>
              <span className="text-caption text-ink-soft">Answered</span>
            </li>
            <li className="hiw-history-2 flex items-center justify-between gap-3 text-sm text-ink">
              <span>Call</span>
              <span className="text-caption text-ink-soft">Missed</span>
            </li>
          </ul>
        </div>
        <div className="hiw-contact-actions flex gap-2 border-t border-line px-3 py-2.5">
          <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium text-ink">
            Call
          </span>
          <span className="rounded-lg bg-whatsapp/15 px-2 py-1 text-caption font-medium text-whatsapp-deep">
            WhatsApp
          </span>
        </div>
      </FrameShell>
    </div>
  );
}

function UsageFrame() {
  return (
    <div className="hiw-usage">
      <FrameShell title="Usage">
        <div className="px-3 py-3">
          <p className="text-caption font-medium text-ink-soft">Package</p>
          <ul className="mt-3 space-y-2.5">
            {USAGE_ROWS.map((label) => (
              <li key={label}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink">{label}</p>
                  <p className="text-caption text-ink-soft">Used</p>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2" />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-caption font-medium text-ink-soft">On-demand rates</p>
          <ul className="mt-1.5">
            {RATE_ROWS.map((label) => (
              <li
                key={label}
                className="flex items-center justify-between border-b border-line py-1.5 text-sm text-ink last:border-b-0"
              >
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </FrameShell>
    </div>
  );
}

const FRAMES = [DeskFrame, PhoneFrame, InboxFrame] as const;

export function HowItWorks({
  actionHref,
  actionLabel,
}: {
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <section className="bg-canvas px-6 py-16 text-ink sm:px-8">
      <div className="mx-auto max-w-desk">
        <h2 className="font-display text-display text-ink">How it works</h2>
        <ol className="mt-8 grid gap-10 lg:grid-cols-3 lg:gap-6">
          {STEPS.map((step, index) => {
            const Frame = FRAMES[index];
            return (
              <li key={step} className="flex flex-col gap-4">
                <p className="flex gap-3 text-base leading-relaxed text-ink">
                  <span className="font-display text-ink-soft">{index + 1}</span>
                  <span>{step}</span>
                </p>
                <Frame />
              </li>
            );
          })}
        </ol>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <ContactsFrame />
          <UsageFrame />
        </div>
        <div className="mt-10">
          <Link
            href={actionHref}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-900 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:shadow-focus"
          >
            {actionLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

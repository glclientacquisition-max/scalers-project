"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { brandAssets } from "@/components/brand/assets";

const STEPS = [
  "You set the business in the Desk: who you are, hours, services, and the answers.",
  "The assistant takes the call.",
  "You get SMS, WhatsApp, or email, then work it in the inbox: call back, WhatsApp, or an SMS you approve.",
] as const;

const DESK_FIELDS = [
  { label: "Who you are", beat: "hiw-b1" },
  { label: "Hours", beat: "hiw-b2" },
  { label: "Services", beat: "hiw-b3" },
  { label: "Answers", beat: "hiw-b4" },
] as const;

function Mark({ className }: { className: string }) {
  return (
    <Image
      src={brandAssets.iconTransparent}
      alt=""
      width={24}
      height={24}
      className={className}
    />
  );
}

function HowItWorksStage() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        stage.dataset.play = "1";
        observer.disconnect();
      },
      { threshold: 0.4 }
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={stageRef} className="hiw-stage mt-8" aria-hidden>
      <div className="hiw-rail">
        <span className="hiw-rail-mark" />
        <span className="hiw-rail-item">Settings</span>
        <span className="hiw-rail-item">Inbox</span>
        <span className="hiw-rail-item">Contacts</span>
        <span className="hiw-rail-item">Usage</span>
      </div>
      <div className="hiw-pane">
        <div className="hiw-scene hiw-scene-desk">
          <p className="hiw-scene-title">Settings</p>
          <ul className="mt-3 space-y-3">
            {DESK_FIELDS.map((field) => (
              <li key={field.label} className={field.beat}>
                <p className="text-caption text-ink-soft">{field.label}</p>
                <div className="mt-1.5 h-2 rounded-full bg-surface-2" />
              </li>
            ))}
          </ul>
        </div>

        <div className="hiw-scene hiw-scene-call">
          <p className="hiw-scene-title">Call</p>
          <div className="hiw-incoming">
            <p className="text-caption text-ink-soft">Incoming</p>
            <p className="mt-1 font-display text-title text-ink">Client</p>
            <span className="hiw-ring mt-4 h-12 w-12 rounded-full border border-accent" />
          </div>
          <div className="hiw-answered">
            <Mark className="h-8 w-8 object-contain" />
            <p className="mt-2 font-display text-title text-ink">Call assistant</p>
            <p className="mt-1 text-caption text-ink-soft">Answered</p>
            <div className="mt-4 flex h-7 items-end gap-1">
              {["a", "b", "a", "b", "a"].map((kind, i) => (
                <span
                  key={i}
                  className={`hiw-wave inline-block w-1 rounded-full bg-accent ${kind === "a" ? "hiw-wave-a h-6" : "hiw-wave-b h-4"}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="hiw-scene hiw-scene-inbox">
          <p className="hiw-scene-title">Inbox</p>
          <p className="hiw-s1 mt-3 rounded-lg border border-line px-2 py-1 text-caption text-ink">
            Search · Client
          </p>
          <ul className="hiw-s2 mt-2 flex flex-wrap gap-1.5">
            <li className="rounded-full bg-accent-tonal px-2 py-0.5 text-caption font-medium text-accent">
              Needs you
            </li>
            <li className="rounded-full border border-line px-2 py-0.5 text-caption text-ink">
              Missed
            </li>
            <li className="rounded-full border border-line px-2 py-0.5 text-caption text-ink">
              Answered
            </li>
          </ul>
          <div className="hiw-s3 mt-3 flex items-start gap-2 border-t border-line pt-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
            <div>
              <p className="text-sm font-medium text-ink">Client</p>
              <p className="text-caption text-ink-soft">Needs you</p>
            </div>
          </div>
          <div className="hiw-s3 mt-2 flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-attention" />
            <div>
              <p className="text-sm font-medium text-ink">Client</p>
              <p className="text-caption text-ink-soft">Missed</p>
            </div>
          </div>
          <div className="hiw-s4 mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <span className="rounded-lg border border-ok/40 bg-ok-soft px-2 py-1 text-caption font-medium text-ok">
              Mark done
            </span>
            <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium text-ink">
              Call
            </span>
            <span className="rounded-lg bg-whatsapp/15 px-2 py-1 text-caption font-medium text-whatsapp-deep">
              WhatsApp
            </span>
            <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium text-ink">
              Email
            </span>
            <span className="rounded-lg bg-accent-tonal px-2 py-1 text-caption font-medium text-accent">
              Send SMS
            </span>
          </div>
        </div>

        <div className="hiw-scene hiw-scene-contacts">
          <p className="hiw-scene-title">Contacts</p>
          <p className="mt-3 text-caption text-ink-soft">Name or number</p>
          <p className="hiw-c1 mt-2 text-sm font-medium text-ink">Client</p>
          <p className="hiw-c1 mt-3 text-caption text-ink-soft">History</p>
          <ul className="hiw-c1 mt-1 space-y-1.5 text-sm text-ink">
            <li className="flex justify-between gap-3">
              <span>Call</span>
              <span className="text-caption text-ink-soft">Answered</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>Call</span>
              <span className="text-caption text-ink-soft">Missed</span>
            </li>
          </ul>
          <div className="hiw-c2 mt-3 flex gap-2 border-t border-line pt-3">
            <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium text-ink">
              Call
            </span>
            <span className="rounded-lg bg-whatsapp/15 px-2 py-1 text-caption font-medium text-whatsapp-deep">
              WhatsApp
            </span>
          </div>
        </div>

        <div className="hiw-scene hiw-scene-usage">
          <p className="hiw-scene-title">Usage</p>
          <p className="mt-3 text-caption text-ink-soft">Package</p>
          <ul className="mt-3 space-y-2">
            {["Minutes", "SMS", "Email", "WhatsApp"].map((label) => (
              <li key={label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">{label}</span>
                  <span className="text-caption text-ink-soft">Used</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2" />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-caption text-ink-soft">On-demand rates</p>
          <ul className="mt-1">
            {["Calls", "SMS", "Email", "WhatsApp"].map((label) => (
              <li key={label} className="border-b border-line py-1.5 text-sm text-ink last:border-b-0">
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks({
  actionHref,
  actionLabel,
}: {
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <section data-landing-craft="skills" className="bg-canvas px-6 py-16 text-ink sm:px-8">
      <div className="mx-auto max-w-desk">
        <h2 className="font-display text-display text-ink">How it works</h2>
        <ol className="mt-6 max-w-xl space-y-3 text-base leading-relaxed text-ink">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="font-display text-ink-soft">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <HowItWorksStage />
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

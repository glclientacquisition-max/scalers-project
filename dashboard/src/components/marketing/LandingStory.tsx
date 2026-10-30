"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { brandAssets } from "@/components/brand/assets";

function Mark({ className }: { className: string }) {
  return (
    <Image src={brandAssets.iconTransparent} alt="" width={40} height={40} className={className} />
  );
}

function usePlayOnMount() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.dataset.play = "1";
  }, []);
  return ref;
}

function usePlayOnView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        node.dataset.play = "1";
        observer.disconnect();
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Hero call card: an incoming call, answered, then the details sent to the owner. Plays once; reduced motion shows the end. */
export function HeroCall({ glass = false }: { glass?: boolean } = {}) {
  const ref = usePlayOnMount();
  return (
    <div
      ref={ref}
      className={`hero-call relative h-full min-h-[20rem] w-full min-w-0 rounded-2xl border text-ink shadow-lift sm:min-h-[26rem] ${glass ? "glass-chrome border-white/25" : "border-hairline bg-surface"}`}
      aria-hidden
    >
      <div className="hero-in flex h-full flex-col justify-center p-6 sm:p-10">
        <p className="text-sm text-ink-2">Incoming call</p>
        <p className="mt-2 font-display text-3xl tracking-tight">Client</p>
        <span className="hero-ring mt-8 h-16 w-16 rounded-full border-2 border-accent" />
      </div>
      <div className="hero-out flex h-full flex-col justify-between gap-6 p-6 sm:p-10">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Mark className="h-9 w-9 object-contain" />
            <div>
              <p className="text-sm text-ink-2">Answered</p>
              <p className="text-base font-medium">Business Assistant</p>
            </div>
          </div>
          <p className="mt-5 font-display text-2xl leading-tight tracking-tight text-ink sm:text-3xl">They asked for a booking.</p>
          <div className="mt-4 flex h-7 items-end gap-1 overflow-hidden">
            <span className="hero-wave hero-wave-a inline-block h-4 w-1 rounded-full bg-accent" />
            <span className="hero-wave hero-wave-b inline-block h-6 w-1 rounded-full bg-accent" />
            <span className="hero-wave hero-wave-a inline-block h-3 w-1 rounded-full bg-accent" />
            <span className="hero-wave hero-wave-b inline-block h-7 w-1 rounded-full bg-accent" />
            <span className="hero-wave hero-wave-a inline-block h-5 w-1 rounded-full bg-accent" />
          </div>
        </div>
        <div className="hero-sms rounded-xl border border-hairline bg-canvas p-3">
          <p className="text-caption font-medium text-ink-2">SMS to you</p>
          <p className="mt-1 text-sm text-ink">New caller. Name, number and what they asked for are in your inbox.</p>
        </div>
      </div>
    </div>
  );
}

const DESK = [
  ["Who you are", "Your business"],
  ["Hours", "Your hours"],
  ["Services", "Your services"],
  ["Answers", "Your answers"],
] as const;

const STEPS = [
  "You set the business in the Desk: who you are, hours, services, and the answers.",
  "Your Business Assistant takes the call.",
  "You get SMS, WhatsApp, or email, then work it in the inbox: call back, WhatsApp, or an SMS you approve.",
] as const;

export function HowStage() {
  const ref = usePlayOnView();
  return (
    <div ref={ref} className="hiw-stage mt-10">
      <ol className="grid list-none gap-10 md:grid-cols-3 md:gap-6">
        <li className="flex min-w-0 flex-col gap-4">
          <div className="hiw-mock overflow-hidden rounded-2xl border border-line glass-chrome" aria-hidden>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Mark className="h-5 w-5 object-contain" />
              <p className="text-sm font-medium">Desk</p>
            </div>
            <ul className="space-y-3 p-3">
              {DESK.map(([label, value]) => (
                <li key={label}>
                  <p className="text-caption text-ink-soft">{label}</p>
                  <p className="mt-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm">{value}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-base leading-relaxed text-ink">{STEPS[0]}</p>
        </li>
        <li className="flex min-w-0 flex-col gap-4">
          <div className="hiw-mock flex flex-col justify-center overflow-hidden rounded-2xl border border-line glass-chrome p-4" aria-hidden>
            <p className="text-sm text-ink-soft">Answered</p>
            <p className="mt-1 font-display text-xl tracking-tight">Client</p>
            <p className="mt-2 text-base">Business Assistant</p>
            <p className="mt-4 font-display text-2xl leading-tight tracking-tight">They asked for a booking.</p>
          </div>
          <p className="text-base leading-relaxed text-ink">{STEPS[1]}</p>
        </li>
        <li className="flex min-w-0 flex-col gap-4">
          <div className="hiw-mock overflow-hidden rounded-2xl border border-line glass-chrome" aria-hidden>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Mark className="h-5 w-5 object-contain" />
              <p className="text-sm font-medium">Inbox</p>
            </div>
            <div className="flex items-start gap-2 px-3 py-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <div>
                <p className="text-sm font-medium">Client</p>
                <p className="text-caption text-ink-soft">Needs you</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2.5">
              <span className="rounded-lg border border-line px-2 py-1 text-caption font-medium">Call</span>
              <span className="rounded-lg bg-whatsapp/15 px-2 py-1 text-caption font-medium text-whatsapp-deep">
                WhatsApp
              </span>
              <span className="rounded-lg bg-accent-tonal px-2 py-1 text-caption font-medium text-accent">
                Send SMS
              </span>
            </div>
          </div>
          <p className="text-base leading-relaxed text-ink">{STEPS[2]}</p>
        </li>
      </ol>
    </div>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { brandAssets } from "@/components/brand/assets";

function Mark({ className }: { className: string }) {
  return (
    <Image src={brandAssets.iconTransparent} alt="" width={40} height={40} className={className} />
  );
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

export function HeroCall() {
  const ref = usePlayOnView();
  return (
    <div ref={ref} className="hero-call rounded-2xl bg-white text-ink" aria-hidden>
      <div className="hero-in flex flex-col justify-center p-6 sm:p-8">
        <p className="text-sm text-ink-soft">Incoming</p>
        <p className="mt-1 font-display text-3xl tracking-tight">Client</p>
        <span className="hero-ring mt-6 h-14 w-14 rounded-full border border-accent" />
      </div>
      <div className="hero-out flex flex-col justify-center p-6 sm:p-8">
        <Mark className="h-10 w-10 object-contain" />
        <p className="mt-6 text-sm text-ink-soft">Answered</p>
        <p className="mt-1 font-display text-3xl tracking-tight">Client</p>
        <p className="mt-2 text-base">Call assistant</p>
        <p className="hero-book mt-3 text-sm text-ink-soft">They asked for a booking.</p>
        <div className="mt-5 flex h-7 items-end gap-1 overflow-hidden">
          <span className="hero-wave hero-wave-a inline-block h-4 w-1 rounded-full bg-accent" />
          <span className="hero-wave hero-wave-b inline-block h-6 w-1 rounded-full bg-accent" />
          <span className="hero-wave hero-wave-a inline-block h-3 w-1 rounded-full bg-accent" />
          <span className="hero-wave hero-wave-b inline-block h-7 w-1 rounded-full bg-accent" />
          <span className="hero-wave hero-wave-a inline-block h-5 w-1 rounded-full bg-accent" />
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

export function HowStage({ children }: { children: ReactNode }) {
  const ref = usePlayOnView();
  return (
    <div ref={ref} className="hiw-stage mt-10">
      <div className="grid gap-4 md:grid-cols-3" aria-hidden>
        <div className="hiw-mock overflow-hidden rounded-2xl border border-line bg-surface">
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
        <div className="hiw-mock flex flex-col justify-center overflow-hidden rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-ink-soft">Answered</p>
          <p className="mt-1 font-display text-2xl tracking-tight">Client</p>
          <p className="mt-2 text-base">Call assistant</p>
          <p className="mt-3 text-sm text-ink-soft">They asked for a booking.</p>
        </div>
        <div className="hiw-mock overflow-hidden rounded-2xl border border-line bg-surface">
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
      </div>
      <div className="mt-10">{children}</div>
    </div>
  );
}

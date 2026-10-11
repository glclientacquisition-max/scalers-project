import type { Metadata } from "next";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { appEntryHref, marketingHomeHref } from "@/lib/adminHost";
import { btnPrimary } from "@/components/ui/deskChrome";

export const metadata: Metadata = {
  title: "Pricing · Scalers",
  description: "Scalers is in free beta.",
};

/** Package prices stay off public pages until pricing is ready (see LandingPage). */
export default function PricingPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href={marketingHomeHref()} context="Pricing" variant="lockup" priority />
        <h1 className="mt-8 font-display text-2xl tracking-tight text-ink">Free beta</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Scalers is free while we&apos;re in beta. We&apos;ll tell you before any charges start.
        </p>
        <a href={appEntryHref("/signup")} className={`${btnPrimary} mt-6 inline-flex`}>
          Sign up
        </a>
      </div>
    </main>
  );
}

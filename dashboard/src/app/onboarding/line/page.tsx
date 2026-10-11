import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { btnPrimary } from "@/components/ui/deskChrome";
import { loadSetupContext } from "@/lib/setupServer";
import { formatKenyaNumber, numberPending } from "@/lib/setupFlow";
import { PendingNumber } from "./PendingNumber";

export const instant = false;

/** Last screen of setup: the phone number callers dial, or a clear "assigning" state. */
export default async function SetupLinePage() {
  const ctx = await loadSetupContext();
  if (ctx.kind === "signed_out") redirect("/login");
  if (ctx.kind !== "ready") redirect("/onboarding");
  if (!ctx.row.setup_completed_at) redirect("/onboarding");

  const raw = ctx.row.sautikit_virtual_number;
  const pending = numberPending(raw);
  const pretty = formatKenyaNumber(raw);

  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center">
      <div className="w-full max-w-md">
        <BrandWordmark href="/home" context="Setup" variant="lockup" priority />
        <h1 className="mt-8 text-display text-ink">{ctx.row.business_name} is set up</h1>

        {pending ? (
          <PendingNumber tenantId={ctx.row.id} />
        ) : (
          <section aria-labelledby="line-label" className="mt-6 rounded-2xl bg-surface p-5">
            <h2 id="line-label" className="text-meta font-medium text-ink-2">
              Your receptionist&apos;s number
            </h2>
            <p className="mt-1 text-[2rem] font-semibold leading-tight tracking-tight tabular-nums text-ink">{pretty}</p>
            <p className="mt-3 text-body text-ink-2">
              Call it from your phone to hear how it answers. Then share it with customers, or forward your business line to it.
            </p>
            <a
              href={`tel:${String(raw).replace(/\s/g, "")}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 text-body font-medium text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Call {pretty}
            </a>
          </section>
        )}

        <Link href="/home" className={`${btnPrimary} mt-8 w-full text-body`}>
          Go to Overview
        </Link>
        <p className="mt-3 text-center text-meta text-ink-2">You can change any answer later in Settings.</p>
      </div>
    </main>
  );
}

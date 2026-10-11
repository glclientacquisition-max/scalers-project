import { BrandWordmark } from "@/components/brand/BrandMark";
import { ResendLink } from "../signup/ResendLink";

/** Signed in but email not confirmed: setup waits for the link. */
export function ConfirmEmailScreen({ email }: { email: string }) {
  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center">
      <div className="w-full max-w-md">
        <BrandWordmark href="/onboarding" context="Setup" variant="lockup" priority />
        <h1 className="mt-8 text-display text-ink">Confirm your email</h1>
        <p className="mt-3 text-body leading-relaxed text-ink-2">
          Open the link we sent to <span className="font-medium text-ink">{email}</span>. Setup starts as soon as
          your email is confirmed.
        </p>
        <div className="mt-6 rounded-2xl bg-surface p-4">
          <ResendLink email={email} />
        </div>
        <form action="/api/logout" method="post" className="mt-6">
          <button type="submit" className="min-h-11 text-meta text-ink-2 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            Use a different account
          </button>
        </form>
      </div>
    </main>
  );
}

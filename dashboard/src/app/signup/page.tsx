import { AppearanceFooter } from "@/components/ThemePicker";
import Link from "next/link";
import { Suspense } from "react";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { marketingHomeHref } from "@/lib/adminHost";
import { getSignupMode, signupCtaLabel } from "@/lib/signupMode";
import { accessPlanFromParam } from "@/lib/accessPlan";
import { RequestAccessForm } from "./RequestAccessForm";
import { SignupForm } from "./SignupForm";

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const requestMode = getSignupMode() === "request";
  const cta = signupCtaLabel();

  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href={marketingHomeHref()} context={cta} variant="lockup" priority />
        {requestMode ? (
          <>
            <h1 className="sr-only">Request access to Scalers</h1>
            <p className="mt-3 text-body text-ink-2">
              Tell us about your business. We&apos;ll email you when your workspace is ready.
            </p>
            <Suspense fallback={<RequestAccessForm />}>
              <PlanRequestForm searchParams={searchParams} />
            </Suspense>
          </>
        ) : (
          <SignupForm />
        )}
        <p className="mt-8 text-meta text-ink-2">
          Already have an account?{" "}
          <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-accent-deep underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
        <footer className="mt-10 flex justify-center">
          <AppearanceFooter />
        </footer>
      </div>
    </main>
  );
}

/** Plan picked on /pricing (?plan=) rides along as a hidden field. */
async function PlanRequestForm({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const plan = accessPlanFromParam((await searchParams).plan);
  return <RequestAccessForm plan={plan} />;
}

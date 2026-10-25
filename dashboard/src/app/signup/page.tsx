import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="Request access" variant="lockup" priority />
        <h1 className="sr-only">Request access to Scalers</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Tell us about your business. We&apos;ll email you when your workspace is ready.
        </p>

        <SignupForm />

        <p className="mt-6 text-sm text-ink-soft">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent-deep hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

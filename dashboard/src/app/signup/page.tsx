import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/signup" priority />
        <h1 className="mt-8 font-display text-2xl tracking-tight text-ink">Create workspace</h1>

        <SignupForm />

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--accent)] hover:text-[var(--accent-deep)]">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

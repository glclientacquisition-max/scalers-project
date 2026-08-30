import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="New workspace" variant="lockup" priority />
        <h1 className="sr-only">Create a Scalers workspace</h1>

        <div className="mt-8">
          <SignupForm />
        </div>

        <p className="mt-6 text-sm text-ink-soft">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

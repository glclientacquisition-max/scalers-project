import Link from "next/link";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="font-display text-4xl text-[var(--accent-deep)] tracking-tight">
          Sauti Desk
        </p>
        <p className="mt-3 text-[var(--ink-soft)] text-base leading-relaxed">
          Create your AI receptionist workspace. It automatically handles English, Kiswahili,
          and Sheng with your callers.
        </p>

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

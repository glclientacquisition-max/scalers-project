import { AppearanceFooter } from "@/components/ThemePicker";
import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { marketingHomeHref } from "@/lib/adminHost";
import { isEmail } from "@/lib/setupFlow";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

// Reads ?email= to prefill the form.
export const instant = false;
export const metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const sp = await searchParams;
  const prefill = String(sp.email || "").trim().toLowerCase();
  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href={marketingHomeHref()} context="Reset password" variant="lockup" priority />
        <ForgotPasswordForm defaultEmail={isEmail(prefill) ? prefill : ""} />
        <p className="mt-8 text-meta text-ink-2">
          Remembered it?{" "}
          <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-accent-deep underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
        <footer className="mt-10 flex justify-center">
          <AppearanceFooter />
        </footer>
      </div>
    </main>
  );
}

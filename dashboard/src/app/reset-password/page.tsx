import { AppearanceFooter } from "@/components/ThemePicker";
import Link from "next/link";
import { cookies } from "next/headers";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { marketingHomeHref } from "@/lib/adminHost";
import { getAuthUser } from "@/lib/auth";
import { RECOVERY_COOKIE } from "@/lib/passwordReset";
import { ResetLinkProblem, ResetPasswordForm } from "./ResetPasswordForm";

// Reads the session and recovery cookie on every request.
export const instant = false;
export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const sp = await searchParams;
  const [user, jar] = await Promise.all([getAuthUser(), cookies()]);
  const recovering = Boolean(user && jar.get(RECOVERY_COOKIE));
  const expired = sp.link === "expired" || (!sp.link && !recovering);

  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href={marketingHomeHref()} context="Reset password" variant="lockup" priority />
        {recovering && !sp.link ? <ResetPasswordForm email={user?.email} /> : <ResetLinkProblem expired={expired} />}
        <p className="mt-8 text-meta text-ink-2">
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

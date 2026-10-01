import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import { marketingHomeHref } from "@/lib/adminHost";
import { getAuthUser } from "@/lib/auth";

// instant = false: owner cookie session must run before the form. Do not wrap the gate in Suspense.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getAuthUser();
  if (user) redirect("/home");
  const homeHref = marketingHomeHref();
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href={homeHref} context="Sign in" variant="lockup" priority />
        <h1 className="sr-only">Sign in to Scalers</h1>

        <form
          action="/api/login"
          method="post"
          className="mt-8 space-y-4 rounded-panel border border-line bg-surface p-6"
        >
          <div>
            <label className="block text-sm font-medium text-ink" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              className={`mt-2 ${deskFieldClass}`}
              placeholder="you@business.co.ke"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={`mt-2 ${deskFieldClass}`}
              placeholder="••••••••"
            />
          </div>
          <Suspense fallback={null}>
            <LoginError searchParams={searchParams} />
          </Suspense>
          <button type="submit" className={`${btnPrimary} w-full`}>
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          New business?{" "}
          <Link href="/signup" className="font-medium text-accent-deep hover:underline">
            Create a workspace
          </Link>
        </p>
        <p className="mt-3">
          <Link
            href={homeHref}
            className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Scalers home
          </Link>
        </p>
      </div>
    </main>
  );
}

async function LoginError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  if (!sp.error) return null;
  const message =
    sp.error === "config"
      ? "Sign in is not available. Try again later."
      : "Invalid email or password.";
  return (
    <p className="mt-1 text-sm text-warn" role="alert">
      {message}
    </p>
  );
}

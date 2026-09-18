import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="Sign in" variant="lockup" priority />
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
          <LoginError searchParams={searchParams} />
          <button type="submit" className={`${btnPrimary} w-full`}>
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          New business?{" "}
          <Link href="/signup" className="font-medium text-[#005CCC] hover:underline">
            Create a workspace
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

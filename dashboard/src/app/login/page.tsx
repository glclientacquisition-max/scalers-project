import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";

const fieldClass =
  "mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="Sign in" variant="lockup" priority />
        <h1 className="sr-only">Sign in to Scalers</h1>

        <form
          action="/api/login"
          method="post"
          className="mt-8 rounded-panel border border-line bg-surface p-6 shadow-lift space-y-4"
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
              className={fieldClass}
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
              className={fieldClass}
              placeholder="••••••••"
            />
          </div>
          <LoginError searchParams={searchParams} />
          <button
            type="submit"
            className="min-h-12 w-full rounded-xl bg-[#0096FF] px-4 py-3 font-medium text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          New business?{" "}
          <Link
            href="/signup"
            className="text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
          >
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
    sp.error === "1"
      ? "Invalid email or password."
      : decodeURIComponent(sp.error);
  return (
    <p className="mt-1 text-sm text-warn" role="alert">
      {message}
    </p>
  );
}

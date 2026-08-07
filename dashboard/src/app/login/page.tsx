import Link from "next/link";
import { BrandWordmark } from "@/components/brand/BrandMark";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/login" context="Sign in" variant="lockup" priority />
        <h1 className="sr-only">Sign in to Scalers</h1>

        <form
          action="/api/login"
          method="post"
          className="mt-8 rounded-panel border border-line bg-surface p-6 shadow-lift space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-[var(--ink)]" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
              placeholder="you@business.co.ke"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ink)]" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
              placeholder="••••••••"
            />
          </div>
          <LoginError searchParams={searchParams} />
          <button
            type="submit"
            className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-white font-medium hover:bg-[var(--accent-deep)] transition"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          New business?{" "}
          <Link href="/signup" className="text-[var(--accent)] hover:text-[var(--accent-deep)]">
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
  return <p className="mt-1 text-sm text-[var(--warn)]">{message}</p>;
}

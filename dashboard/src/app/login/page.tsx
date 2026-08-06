import Link from "next/link";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <p className="font-display text-4xl text-[var(--accent-deep)] tracking-tight">
          Sauti Desk
        </p>
        <p className="mt-3 text-[var(--ink-soft)] text-base leading-relaxed">
          Sign in to review missed-call leads and tune your receptionist.
        </p>

        <form
          action="/api/login"
          method="post"
          className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-[0_20px_50px_-35px_rgba(28,36,33,0.45)] space-y-4"
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
            Enter desk
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

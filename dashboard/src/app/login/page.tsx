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
          className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-[0_20px_50px_-35px_rgba(28,36,33,0.45)]"
        >
          <label className="block text-sm font-medium text-[var(--ink)]" htmlFor="password">
            Dashboard password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            placeholder="••••••••"
          />
          <LoginError searchParams={searchParams} />
          <button
            type="submit"
            className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-white font-medium hover:bg-[var(--accent-deep)] transition"
          >
            Enter desk
          </button>
        </form>

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Voice engine stays on Railway — this desk only reads Supabase.
        </p>
        <Link href="/calls" className="hidden">
          calls
        </Link>
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
  return <p className="mt-3 text-sm text-[var(--warn)]">Wrong password. Try again.</p>;
}

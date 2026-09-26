import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import { isLegacyAuthenticated } from "@/lib/auth";

export const instant = false;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isLegacyAuthenticated()) {
    redirect("/admin");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href="/admin/login" context="Super Admin" variant="lockup" priority />
        <h1 className="sr-only">Super Admin</h1>

        <form
          action="/api/admin/session"
          method="post"
          className="mt-8 space-y-4 rounded-panel border border-line bg-surface p-6"
        >
          <div>
            <label className="block text-sm font-medium text-ink" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoFocus
              autoComplete="username"
              spellCheck={false}
              className={`mt-2 ${deskFieldClass}`}
              placeholder="kigen"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink" htmlFor="accessCode">
              Access code
            </label>
            <input
              id="accessCode"
              name="accessCode"
              type="password"
              required
              autoComplete="current-password"
              className={`mt-2 ${deskFieldClass}`}
            />
          </div>
          <Suspense fallback={null}>
            <AdminLoginError searchParams={searchParams} />
          </Suspense>
          <button type="submit" className={`${btnPrimary} w-full`}>
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}

async function AdminLoginError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  if (!sp.error) return null;
  return (
    <p className="mt-1 text-sm text-warn" role="alert">
      Invalid username or access code.
    </p>
  );
}

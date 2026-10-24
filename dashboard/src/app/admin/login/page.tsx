import { AppearanceFooter } from "@/components/ThemePicker";
import { Button } from "@/components/ui/Button";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { getAdminSessionRaw, isLegacyAuthenticated } from "@/lib/auth";
import { AdminSignInTwoFactor } from "@/components/admin/AdminSignInTwoFactor";
import { signInTwoFactorRequired } from "@/lib/ops/stepUpCore";

export const instant = false;

/** Same field box as the owner sign-in, at 16px so the phone does not zoom. */
const adminLoginFieldClass = deskFieldClass.replace("text-body", "text-body");

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; step?: string }>;
}) {
  if (await isLegacyAuthenticated()) {
    redirect("/admin");
  }

  const invalid = Boolean((await searchParams).error);
  // Username + access code passed, second factor still owed (ADMIN_STEP_UP_ENFORCE=on).
  const raw = signInTwoFactorRequired() ? await getAdminSessionRaw() : null;
  const secondStep = Boolean(raw?.user?.name);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <BrandWordmark href="/admin/login" context="Super Admin" variant="lockup" priority />
        </div>
        <h1 className="sr-only">Super Admin</h1>

        {secondStep ? (
          <>
            <AdminSignInTwoFactor fieldClass={adminLoginFieldClass} />
            <form action="/api/logout" method="post" className="mt-4 flex justify-center">
              <button type="submit" className="min-h-11 text-body text-ink-2 underline">Use a different account</button>
            </form>
          </>
        ) : (
        <form action="/api/admin/session" method="post" className="glass-chrome mt-8 space-y-4 rounded-panel border border-hairline p-6">
          <div>
            <label className="block text-body font-medium text-ink" htmlFor="username">
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
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "admin-login-error" : undefined}
              className={`mt-2 ${adminLoginFieldClass}`}
              placeholder="kigen"
            />
          </div>
          <div>
            <label className="block text-body font-medium text-ink" htmlFor="accessCode">
              Access code
            </label>
            <input
              id="accessCode"
              name="accessCode"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "admin-login-error" : undefined}
              className={`mt-2 ${adminLoginFieldClass}`}
            />
          </div>
          {invalid ? (
            <p id="admin-login-error" className="text-body text-warn" role="alert">
              Invalid username or access code.
            </p>
          ) : null}
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
        )}
        <footer className="mt-10 flex justify-center">
          <AppearanceFooter />
        </footer>
      </div>
    </main>
  );
}

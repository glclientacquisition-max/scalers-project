import { AppearanceFooter } from "@/components/ThemePicker";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { marketingHomeHref } from "@/lib/adminHost";
import { getAuthUser } from "@/lib/auth";
import { loginNextPath } from "@/lib/shortCallLink";
import { Field, Input } from "@/components/ui/Field";
import { PendingSubmit } from "./PendingSubmit";
import { ResendDisclosure } from "./ResendDisclosure";

// Session read stays inside Suspense so a signed-in visit can redirect.
// A top-level await here leaves client navigation on a blank page.
export const instant = false;

function LoginFallback() {
  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        <h1 className="mt-8 text-display text-ink">Sign in</h1>
        <p className="mt-4 text-body text-ink-2" role="status">Checking your session.</p>
      </div>
    </main>
  );
}

function notice(sp: { error?: string; link?: string }): { tone: "ok" | "warn"; text: string } | null {
  if (sp.error === "config") return { tone: "warn", text: "Sign in is not available. Try again later." };
  if (sp.error) return { tone: "warn", text: "That email and password don't match. Check them and try again." };
  if (sp.link === "confirmed") return { tone: "ok", text: "Your email is confirmed. Sign in to continue setup." };
  if (sp.link === "expired") return { tone: "warn", text: "That link has expired. Sign in, or send yourself a new link below." };
  return null;
}

async function LoginGate({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; link?: string; next?: string }>;
}) {
  const user = await getAuthUser();
  const sp = await searchParams;
  // Short call links from staff SMS (/c/<code>) come back here after sign-in.
  const next = loginNextPath(sp.next);
  if (user) redirect(next || "/home");
  const msg = notice(sp);
  const homeHref = marketingHomeHref();

  return (
    <main className="flex min-h-dvh justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        <BrandWordmark href={homeHref} context="Sign in" variant="lockup" priority />
        <h1 className="mt-8 text-display text-ink">Sign in</h1>

        {msg ? (
          <p
            role={msg.tone === "warn" ? "alert" : "status"}
            className={`mt-4 rounded-xl px-4 py-3 text-meta ${msg.tone === "warn" ? "bg-attention-tonal text-attention" : "bg-accent-soft text-ink"}`}
          >
            {msg.text}
          </p>
        ) : null}

        <form action="/api/login" method="post" className="mt-6 space-y-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Field id="email" label="Email">
            {(p) => (
              <Input {...p} name="email" type="email" required autoFocus autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} />
            )}
          </Field>
          <Field id="password" label="Password">
            {(p) => <Input {...p} name="password" type="password" required autoComplete="current-password" />}
          </Field>
          <p className="-mt-2 flex justify-end">
            <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-meta font-medium text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              Forgot password?
            </Link>
          </p>
          <PendingSubmit label="Sign in" pendingLabel="Signing in…" />
        </form>

        <ResendDisclosure defaultOpen={sp.link === "expired"} />

        <p className="mt-8 text-meta text-ink-2">
          New to Scalers?{" "}
          <Link href="/signup" className="inline-flex min-h-11 items-center font-medium text-accent-deep underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
        <p>
          <Link href={homeHref} className="inline-flex min-h-11 items-center text-meta text-ink-2 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            Scalers home
          </Link>
        </p>
        <footer className="mt-10 flex justify-center">
          <AppearanceFooter />
        </footer>
      </div>
    </main>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; link?: string; next?: string }>;
}) {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginGate searchParams={searchParams} />
    </Suspense>
  );
}

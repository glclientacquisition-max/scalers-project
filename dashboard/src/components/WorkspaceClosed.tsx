import { BrandWordmark } from "@/components/brand/BrandMark";
import { buttonClass } from "@/components/ui/Button";

/** Owners and staff of a business a Super Admin archived. Plain message, sign out, nothing else. */
export function WorkspaceClosed({ businessName }: { businessName: string | null }) {
  return (
    <main
      className="flex min-h-dvh justify-center bg-surface-canvas px-4 pb-16 pt-10 sm:items-center sm:px-6"
      data-workspace-closed=""
    >
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="Desk" variant="lockup" priority />
        <section className="mt-8 space-y-5">
          <div className="space-y-2 px-1">
            <h1 className="text-page text-ink">
              {businessName ? `${businessName} is closed` : "This business is closed"}
            </h1>
            <p className="text-body text-ink-2">
              This account was closed, so you can&apos;t sign in to it. If you think this is a mistake, contact
              Scalers support.
            </p>
          </div>
          <form action="/api/logout" method="post">
            <button type="submit" className={buttonClass({ variant: "tonal", size: "lg", block: true })}>
              Sign out
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

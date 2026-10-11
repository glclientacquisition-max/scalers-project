import { BrandWordmark } from "@/components/brand/BrandMark";

/** Staff / view-only members of a workspace whose owner hasn't finished setup. */
export function WorkspaceNotReady({ businessName }: { businessName: string | null }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16" data-workspace-not-ready="">
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="Desk" variant="lockup" priority />
        <section className="glass-chrome mt-8 rounded-panel border border-line p-6">
          <h1 className="font-display text-xl tracking-tight text-ink">
            {businessName ? `${businessName} isn't set up yet` : "This workspace isn't set up yet"}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            The owner still needs to finish setting up the business. Ask them to complete setup, then come back here.
          </p>
          <form action="/api/logout" method="post" className="mt-5">
            <button type="submit" className="text-sm font-medium text-accent-deep hover:underline">
              Sign out
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

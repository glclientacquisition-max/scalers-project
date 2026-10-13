import { BrandWordmark } from "@/components/brand/BrandMark";
import { buttonClass } from "@/components/ui/Button";

/** Staff / view-only members of a workspace whose owner hasn't finished setup. */
export function WorkspaceNotReady({ businessName }: { businessName: string | null }) {
  return (
    <main className="flex min-h-dvh justify-center bg-surface-canvas px-4 pb-16 pt-10 sm:items-center sm:px-6" data-workspace-not-ready="">
      <div className="w-full max-w-md">
        <BrandWordmark href="/" context="Desk" variant="lockup" priority />
        <section className="mt-8 space-y-5">
          <div className="space-y-2 px-1">
            <h1 className="text-page text-ink">
              {businessName ? `${businessName} isn't set up yet` : "This workspace isn't set up yet"}
            </h1>
            <p className="text-body text-ink-2">The owner needs to finish setup. Come back once they have.</p>
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

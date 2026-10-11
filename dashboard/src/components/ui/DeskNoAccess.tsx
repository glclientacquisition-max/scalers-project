import Link from "next/link";
import { btnGhost, deskEmptyClass } from "@/components/ui/deskChrome";

/** Shown when the member's role can't open this desk page (team roles). */
export function DeskNoAccess({ what = "this page" }: { what?: string }) {
  return (
    <div className={deskEmptyClass} data-desk-no-access="">
      <p className="font-display text-2xl tracking-tight text-ink">No access</p>
      <p className="mt-2 text-sm text-ink-soft">
        Your role can&apos;t open {what}. Ask the business owner if you need it.
      </p>
      <Link href="/home" className={`${btnGhost} mt-6`}>
        Back to Overview
      </Link>
    </div>
  );
}

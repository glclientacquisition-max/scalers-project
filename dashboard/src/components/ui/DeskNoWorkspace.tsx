import Link from "next/link";
import { btnGhost, deskEmptyClass } from "@/components/ui/deskChrome";

export function DeskNoWorkspace() {
  return (
    <div className={deskEmptyClass}>
      <p className="font-display text-2xl tracking-tight text-ink">No workspace</p>
      <p className="mt-2 text-sm text-ink-soft">This account isn&apos;t linked to a business yet.</p>
      <Link href="/onboarding" className={`${btnGhost} mt-6`}>
        Create a workspace
      </Link>
    </div>
  );
}

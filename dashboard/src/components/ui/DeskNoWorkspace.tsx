import Link from "next/link";
import { btnGhost, deskEmptyClass } from "@/components/ui/deskChrome";

export function DeskNoWorkspace() {
  return (
    <div className={deskEmptyClass}>
      <p className="font-display text-page tracking-tight text-ink">No workspace</p>
      <p className="mt-2 text-body text-ink-2">This account isn&apos;t linked to a business yet.</p>
      <Link href="/onboarding" className={`${btnGhost} mt-6`}>
        Create a workspace
      </Link>
    </div>
  );
}

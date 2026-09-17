import Link from "next/link";
import { btnGhost, deskEmptyClass } from "@/components/ui/deskChrome";

export function DeskNoWorkspace() {
  return (
    <div className={deskEmptyClass}>
      <p className="font-display text-2xl tracking-tight text-ink">No workspace</p>
      <Link href="/signup" className={`${btnGhost} mt-6`}>
        Create one
      </Link>
    </div>
  );
}

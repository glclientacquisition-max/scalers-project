import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { SettingsGroup } from "@/components/settingsUi";
import { deskShiftClass } from "@/components/ui/deskChrome";

export type DataCheck = { href: string; label: string; detail: string };

/** Overview: owner "Is this right?" checks for facts read from old text. Hidden when nothing to check. */
export function DataChecksCard({ checks }: { checks: DataCheck[] }) {
  if (!checks.length) return null;
  return (
    <SettingsGroup title="Is this right?">
      {checks.map((c) => (
        <Link key={c.href + c.label} href={c.href}
          className={`flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${deskShiftClass}`}>
          <span className="min-w-0 flex-1">
            <span className="block text-body text-ink">{c.label}</span>
            <span className="block text-meta text-ink-2">{c.detail}</span>
          </span>
          <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
        </Link>
      ))}
    </SettingsGroup>
  );
}

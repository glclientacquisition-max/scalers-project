import Link from "next/link";
import { CheckIcon } from "@heroicons/react/20/solid";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { SettingsGroup } from "@/components/settingsUi";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import type { ReadyChecklistItem } from "@/lib/assistantSayTypes";

/** Compact checklist on Overview until every item is done. */
export function HomeGetReadyCallsCard({ items }: { items: ReadyChecklistItem[] }) {
  if (!items.length || items.every((i) => i.complete)) return null;

  return (
    <SettingsGroup title="Get ready for calls">
      <ul className="divide-y divide-hairline">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
            <span
              className={[
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                item.complete ? "bg-ok-tonal text-ok" : "border border-hairline",
              ].join(" ")}
              aria-hidden
            >
              {item.complete ? <CheckIcon className="size-4" /> : null}
            </span>
            {item.complete ? (
              <span className="text-body text-ink-2">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className={[
                  "text-body font-medium text-accent-deep underline-offset-2 hover:underline",
                  deskShiftClass,
                  focusRingVisible,
                ].join(" ")}
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-hairline px-4 py-3 text-meta text-ink-3">
        <Link
          href={businessSettingsHref("assistant-say")}
          className={[
            "font-medium text-accent-deep underline-offset-2 hover:underline",
            deskShiftClass,
            focusRingVisible,
          ].join(" ")}
        >
          What your Business Assistant will say
        </Link>
      </p>
    </SettingsGroup>
  );
}

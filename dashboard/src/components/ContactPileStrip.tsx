import Link from "next/link";
import { deskShiftClass } from "@/components/ui/deskChrome";
import type { ContactSavedFilter } from "@/lib/contactsLoad";

export function ContactPileStrip({
  recents,
  favourites,
  unsaved,
  recentsHref,
  favouritesHref,
  unsavedHref,
  active,
}: {
  recents: number;
  favourites: number;
  unsaved: number;
  recentsHref: string;
  favouritesHref: string;
  unsavedHref: string;
  active: ContactSavedFilter;
}) {
  const items = [
    { id: "recent" as const, label: "recent", value: recents, href: recentsHref },
    {
      id: "favourite" as const,
      label: "favourites",
      value: favourites,
      href: favouritesHref,
    },
    { id: "unsaved" as const, label: "unsaved", value: unsaved, href: unsavedHref },
  ];

  return (
    <nav
      data-contact-pile-strip=""
      aria-label="Contact piles"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft"
    >
      {items.map((item, index) => {
        const isActive = active === item.id;
        return (
          <span key={item.id} className="inline-flex min-w-0 items-center gap-3">
            {index > 0 ? (
              <span aria-hidden="true" className="h-3 w-px bg-line" />
            ) : null}
            <Link
              href={item.href}
              data-contact-pile={item.id}
              aria-current={isActive ? "page" : undefined}
              className={[
                "inline-flex min-h-11 items-center gap-1.5 tabular-nums",
                deskShiftClass,
                "focus:outline-none focus:ring-2 focus:ring-[#0096FF]",
                isActive ? "font-semibold text-ink" : "hover:text-ink",
              ].join(" ")}
            >
              <span>{item.value}</span>
              <span>{item.label}</span>
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

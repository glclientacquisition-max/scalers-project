import Link from "next/link";
import {
  deskRateCardClass,
  deskRateCardCountClass,
  deskRateCardRowClass,
} from "@/components/ui/deskChrome";
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
    <nav data-contact-pile-strip="" aria-label="Contact piles" className="relative">
      <ul className={deskRateCardRowClass}>
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id} className="snap-start shrink-0">
              <Link
                href={item.href}
                data-contact-pile={item.id}
                aria-current={isActive ? "page" : undefined}
                className={deskRateCardClass(isActive)}
              >
                {item.label}
                <span className={deskRateCardCountClass(isActive)}>
                  {item.value}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent"
      />
    </nav>
  );
}

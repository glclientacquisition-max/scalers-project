import Link from "next/link";
import { deskShiftClass } from "@/components/ui/deskChrome";
import type { ContactSavedFilter } from "@/lib/contactsLoad";

export function ContactPileCards({
  recents,
  favourites,
  recentsHref,
  favouritesHref,
  active,
}: {
  recents: number;
  favourites: number;
  recentsHref: string;
  favouritesHref: string;
  active: ContactSavedFilter;
}) {
  const cards = [
    {
      id: "recent" as const,
      title: "Recents",
      value: recents,
      href: recentsHref,
    },
    {
      id: "favourite" as const,
      title: "Favourites",
      value: favourites,
      href: favouritesHref,
    },
  ];

  return (
    <section
      data-contact-pile-cards=""
      aria-label="Contact piles"
      className="flex min-w-0 gap-2"
    >
      {cards.map((card) => {
        const isActive = active === card.id;
        return (
          <Link
            key={card.id}
            href={card.href}
            data-contact-pile={card.id}
            aria-current={isActive ? "page" : undefined}
            className={[
              "min-w-0 min-h-11 flex-1 rounded-2xl border px-3 py-3",
              deskShiftClass,
              "focus:outline-none focus:ring-2 focus:ring-[#0096FF]",
              isActive
                ? "border-[#0096FF] bg-accent/[0.08]"
                : "border-line bg-surface hover:border-accent/40",
            ].join(" ")}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              {card.title}
            </p>
            <p className="mt-1 font-display text-xl tabular-nums leading-none text-ink">
              {card.value}
            </p>
          </Link>
        );
      })}
    </section>
  );
}

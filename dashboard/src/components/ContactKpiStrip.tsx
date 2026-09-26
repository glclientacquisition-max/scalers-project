import Link from "next/link";
import type { ContactPersonKpiCard } from "@/lib/contactPersonFile";

export function ContactKpiStrip({
  cards,
  hrefs,
}: {
  cards: ContactPersonKpiCard[];
  hrefs?: Partial<Record<ContactPersonKpiCard["id"], string>>;
}) {
  if (!cards.length) return null;

  return (
    <section
      data-contact-kpi-strip=""
      aria-label="Contact facts"
      className="flex min-w-0 gap-2"
    >
      {cards.map((card) => {
        const href = hrefs?.[card.id];
        const body = (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              {card.label}
            </p>
            <p className="mt-1 font-display text-xl tabular-nums leading-none text-ink">
              {card.value}
            </p>
          </>
        );
        return href ? (
          <Link
            key={card.id}
            href={href}
            data-contact-kpi={card.id}
            className="min-w-0 min-h-11 flex-1 rounded-2xl border border-line bg-surface px-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
          >
            {body}
          </Link>
        ) : (
          <article
            key={card.id}
            data-contact-kpi={card.id}
            className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3 py-3"
          >
            {body}
          </article>
        );
      })}
    </section>
  );
}

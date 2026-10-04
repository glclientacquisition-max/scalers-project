import { PhoneIcon } from "@heroicons/react/24/outline";
import { Stamp } from "@/components/ui/Stamp";

const ROWS = [
  {
    title: "After hours",
    preview: "Asked for a person",
    when: "Now",
    stamp: "Needs you",
    tone: "attention" as const,
    live: true,
  },
  {
    title: "Busy line",
    preview: "Wants a callback",
    when: "Today",
    stamp: "Return call",
    tone: "neutral" as const,
    live: false,
  },
  {
    title: "Contact",
    preview: "Name and number saved",
    when: "Today",
    stamp: "Answered",
    tone: "ok" as const,
    live: false,
  },
];

/**
 * Static inbox in the Scalers app. Labels match the product (Needs you, Return calls, Contacts).
 * No customer names, counts, or percentages.
 */
export function AppMock() {
  return (
    <figure
      id="app"
      className="scroll-mt-28 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sheet"
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <span className="font-display text-title text-ink">Inbox</span>
        <span className="text-meta text-ink-3">Scalers app</span>
      </figcaption>
      <div className="flex gap-4 border-b border-hairline px-4 text-meta" aria-hidden="true">
        <span className="border-b-2 border-brand py-3 font-medium text-ink">Needs you</span>
        <span className="py-3 text-ink-3">Return calls</span>
        <span className="py-3 text-ink-3">Contacts</span>
      </div>
      <ul className="divide-y divide-hairline">
        {ROWS.map((row) => (
          <li key={row.title} className="flex items-center gap-3 px-4 py-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <PhoneIcon className={`h-5 w-5 ${row.live ? "landing-loop" : ""}`} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{row.title}</span>
                <span className="shrink-0 text-caption tabular-nums text-ink-3">{row.when}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{row.preview}</span>
                <Stamp tone={row.tone}>{row.stamp}</Stamp>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

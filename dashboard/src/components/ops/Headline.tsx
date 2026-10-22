import type { ReactNode } from "react";

export type HeadlineAction = { label: string; href: string };

/** One headline number with at most two actions beside it. No card: a hairline below separates it. */
export function Headline({ label, value, sub, actions = [], children }: { label: string; value: ReactNode; sub?: ReactNode; actions?: HeadlineAction[]; children?: ReactNode }) {
  return (
    <section data-headline="" className="flex flex-col gap-ops-2 border-b border-hairline pb-ops-3">
      <div className="flex flex-wrap items-end gap-x-ops-4 gap-y-ops-2">
        <div className="min-w-0">
          <div className="text-ops-label text-ink-2">{label}</div>
          <div className="ops-num text-ops-kpi leading-tight text-ink">{value}</div>
          {sub ? <div className="text-ops-body text-ink-2">{sub}</div> : null}
        </div>
        {actions.length ? (
          <div className="flex items-center gap-ops-2 md:ms-auto">
            {actions.slice(0, 2).map((a, i) => (
              <a
                key={a.href}
                href={a.href}
                className={[
                  "inline-flex h-ops-touch items-center rounded-sm px-ops-3 text-ops-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:h-8",
                  i === 0 ? "bg-accent text-accent-on hover:bg-accent-hover" : "border border-hairline text-ink hover:bg-surface-2",
                ].join(" ")}
              >
                {a.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

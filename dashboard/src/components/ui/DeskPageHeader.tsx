import type { ReactNode } from "react";

export function DeskPageHeader({
  title,
  waiting,
  waitingLabel,
  children,
}: {
  title: string;
  waiting?: number;
  waitingLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {waiting != null && waitingLabel ? (
          <p className="mt-1 text-[13px] text-ink-soft">
            <span className="tabular-nums font-medium text-ink">{waiting}</span>{" "}
            {waitingLabel}
          </p>
        ) : null}
      </div>
      {children}
    </header>
  );
}

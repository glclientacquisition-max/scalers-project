import { OpsSkeleton } from "./States";

/**
 * Loading placeholders that mirror the real layout at real row heights: tables with the real column
 * count (h-ops-row rows, hairlines between), a headline with its two actions, and the split pane's
 * sections. Grey text-height blocks only, never one tall block.
 */
export type SkelCol = { w: string; end?: boolean };

const WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/4"];

export function SkelTable({ cols, rows, label }: { cols: SkelCol[]; rows: number; label?: string }) {
  return (
    <table className="w-full table-fixed text-ops-body" aria-hidden="true" data-skel-table={label ?? ""}>
      <thead>
        <tr className="h-ops-row border-b border-hairline">
          {cols.map((c, i) => (
            <th key={i} className={["px-ops-3 font-normal", c.w].join(" ")}>
              <OpsSkeleton className={["h-2.5 w-1/2", c.end ? "ms-auto" : ""].join(" ")} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline bg-surface">
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} className="h-ops-row">
            {cols.map((c, i) => (
              <td key={i} className="px-ops-3">
                <OpsSkeleton className={["h-3", c.end ? "ms-auto w-1/2" : WIDTHS[(r + i) % WIDTHS.length]].join(" ")} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Phone list rows: two lines each, same 44px+ rows as the real phone list. */
export function SkelPhoneRows({ rows }: { rows: number }) {
  return (
    <ul className="divide-y divide-hairline bg-surface md:hidden" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <li key={r} className="flex min-h-ops-touch items-center justify-between gap-2 px-ops-3 py-2">
          <span className="flex w-2/3 flex-col gap-1.5"><OpsSkeleton className={["h-3", WIDTHS[r % 5]].join(" ")} /><OpsSkeleton className="h-2.5 w-1/2" /></span>
          <span className="flex w-1/4 flex-col items-end gap-1.5"><OpsSkeleton className="h-3 w-3/4" /><OpsSkeleton className="h-2.5 w-1/2" /></span>
        </li>
      ))}
    </ul>
  );
}

/** Headline: label, big number, sub line, and the two actions beside it. */
export function SkelHeadline() {
  return (
    <div className="flex flex-wrap items-end gap-x-ops-4 gap-y-ops-2 border-b border-hairline pb-ops-3" aria-hidden="true">
      <div className="flex min-w-0 flex-col gap-ops-2">
        <OpsSkeleton className="h-3 w-56" />
        <OpsSkeleton className="h-7 w-36" />
        <OpsSkeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex items-center gap-ops-2 md:ms-auto">
        <OpsSkeleton className="h-ops-touch w-32 md:h-8" />
        <OpsSkeleton className="h-ops-touch w-20 md:h-8" />
      </div>
    </div>
  );
}

/** The split pane at md+: header bar, key facts, history and related sections at their real row heights. */
export function SkelPane({ facts = 8, history = 12, related = 3 }: { facts?: number; history?: number; related?: number }) {
  const head = <OpsSkeleton className="h-2.5 w-24" />;
  return (
    <aside className="ops-split-pane ops-theme hidden min-h-0 flex-col border-s border-hairline bg-surface md:flex" aria-hidden="true" data-skel-pane="">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-ops-4"><OpsSkeleton className="h-4 w-48" /><OpsSkeleton className="ms-auto h-5 w-5" /></div>
      <div className="flex flex-col divide-y divide-hairline overflow-hidden px-ops-4 py-ops-3">
        <section className="flex flex-col gap-ops-2 pb-ops-3">
          {head}
          <div className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-ops-4 gap-y-ops-1">
            {Array.from({ length: facts }, (_, i) => (
              <div key={i} className="contents">
                <span className="flex h-5 items-center"><OpsSkeleton className="h-3 w-24" /></span>
                <span className="flex h-5 items-center"><OpsSkeleton className={["h-3", WIDTHS[i % 5]].join(" ")} /></span>
              </div>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-ops-2 py-ops-3">
          {head}
          {Array.from({ length: history }, (_, i) => (
            <div key={i} className="grid min-h-ops-row grid-cols-[7.5rem_1fr] items-center gap-ops-3 border-b border-hairline last:border-b-0">
              <OpsSkeleton className="h-3 w-24" />
              <OpsSkeleton className={["h-3", WIDTHS[(i + 2) % 5]].join(" ")} />
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-ops-1 py-ops-3">
          {head}
          {Array.from({ length: related }, (_, i) => (
            <div key={i} className="flex min-h-ops-row items-center"><OpsSkeleton className={["h-3", WIDTHS[(i + 1) % 5]].join(" ")} /></div>
          ))}
        </section>
      </div>
    </aside>
  );
}

/** KPI row: matches .ops-tiles (2 on phone, auto-fit on desk). */
export function SkelKpi({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="ops-tiles" aria-hidden="true" data-skel-kpi="">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface p-ops-3">
          <OpsSkeleton className="h-2.5 w-1/2" />
          <OpsSkeleton className="h-6 w-2/3" />
          <OpsSkeleton className="h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** List + optional pane: phone rows, desk table, closed-pane list fills width. */
export function SkelSplit({ cols, rows = 10, pane = true }: { cols: SkelCol[]; rows?: number; pane?: boolean }) {
  return (
    <div className="ops-theme ops-split -me-4 flex min-h-0 w-[calc(100%+16px)] shrink-0" aria-busy="true" data-skel-split="">
      <div className="ops-split-list min-w-0 flex-1 overflow-auto pe-ops-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-ops-3">
          <OpsSkeleton className="h-6 w-40" />
          <OpsSkeleton className="ms-auto h-8 w-48" />
        </div>
        <SkelPhoneRows rows={Math.min(rows, 8)} />
        <div className="hidden md:block"><SkelTable cols={cols} rows={rows} /></div>
      </div>
      {pane ? <SkelPane /> : null}
    </div>
  );
}

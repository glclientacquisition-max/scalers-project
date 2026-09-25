"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ContactTimelineWhat } from "@/components/ContactTimelineWhat";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { DeskRowHit, deskRowActionClass, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { btnGhost, deskFieldClass, deskPreviewCellClass, deskShiftClass } from "@/components/ui/deskChrome";
import { formatCallWhen } from "@/lib/callsTriage";
import {
  CONTACT_HISTORY_PAGE,
  contactHistoryChips,
  contactHistoryGroupCopy,
  pageContactHistory,
  type ContactHistoryFilter,
  type ContactHistoryRow,
} from "@/lib/contactHistoryView";
import type { ContactTimelineEntry } from "@/lib/contactPersonFile";

function TimelineRowHit({ entry }: { entry: ContactTimelineEntry }) {
  return entry.href ? <DeskRowHit href={entry.href} label="Conversation" /> : null;
}

function SinglePhone({ entry }: { entry: ContactTimelineEntry }) {
  return (
    <li
      className={[
        "relative min-w-0 px-3 py-3",
        entry.href ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <TimelineRowHit entry={entry} />
      <div className={`${deskRowMutedClass} flex min-w-0 items-baseline justify-between gap-2`}>
        <p className="truncate text-xs tabular-nums text-ink-soft">
          {formatCallWhen(entry.createdAt)}
        </p>
        <InboxPurposeChip purpose={entry.purpose} label={entry.stamp} />
      </div>
      <div className={`${deskRowActionClass} mt-1 min-w-0`}>
        <ContactTimelineWhat headline={entry.headline} detail={entry.detail} />
      </div>
    </li>
  );
}

function SingleTable({ entry }: { entry: ContactTimelineEntry }) {
  return (
    <tr
      className={[
        "relative border-t border-line/50",
        entry.href ? "cursor-pointer hover:bg-accent/[0.04]" : "",
      ].join(" ")}
    >
      <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-4 text-ink-soft`}>
        <TimelineRowHit entry={entry} />
        {formatCallWhen(entry.createdAt)}
      </td>
      <td className={`${deskRowMutedClass} px-5 py-4`}>
        <InboxPurposeChip purpose={entry.purpose} label={entry.stamp} />
      </td>
      <td className={`${deskPreviewCellClass} px-5 py-4`}>
        <ContactTimelineWhat headline={entry.headline} detail={entry.detail} />
      </td>
    </tr>
  );
}

export function ContactHistory({
  rows,
  filter,
  q,
  chipHrefs,
}: {
  rows: ContactHistoryRow[];
  filter: ContactHistoryFilter;
  q: string;
  chipHrefs: Record<ContactHistoryFilter, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(CONTACT_HISTORY_PAGE);
  const chips = contactHistoryChips();
  const [value, setValue] = useState(q);
  const visible = pageContactHistory(rows, shown);
  const remaining = Math.max(0, rows.length - visible.length);

  useEffect(() => {
    setShown(CONTACT_HISTORY_PAGE);
  }, [filter, q]);

  function syncQuery(next: string) {
    const params = new URLSearchParams(search.toString());
    if (next.trim()) params.set("hq", next.trim());
    else params.delete("hq");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <section data-contact-history="">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl tracking-tight text-ink">History</h2>
      </div>
      <div className="mt-3">
        <label className="sr-only" htmlFor="contact-history-search">
          Search this history
        </label>
        <input
          id="contact-history-search"
          type="search"
          value={value}
          placeholder="Search this history"
          className={deskFieldClass}
          onChange={(event) => {
            const next = event.currentTarget.value.slice(0, 64);
            setValue(next);
            syncQuery(next);
          }}
        />
      </div>
      <div className="mt-3">
        <InboxFilterPills
          label="Filter history"
          active={filter}
          items={chips.map((chip) => ({
            id: chip.id,
            label: chip.label,
            href: chipHrefs[chip.id],
          }))}
        />
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No calls or jobs yet.</p>
      ) : (
        <>
          <ul className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {visible.map((row) =>
              row.kind === "single" ? (
                <SinglePhone key={row.entry.id} entry={row.entry} />
              ) : (
                <GroupPhone
                  key={row.group.id}
                  row={row}
                  open={Boolean(openIds[row.group.id])}
                  onToggle={() =>
                    setOpenIds((prev) => ({
                      ...prev,
                      [row.group.id]: !prev[row.group.id],
                    }))
                  }
                />
              )
            )}
          </ul>
          <div className="mt-4 hidden min-w-0 overflow-x-auto rounded-2xl border border-line bg-surface md:block">
            <table className="w-full min-w-0 text-left text-sm">
              <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                <tr>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    When
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    What
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) =>
                  row.kind === "single" ? (
                    <SingleTable key={row.entry.id} entry={row.entry} />
                  ) : (
                    <GroupTable
                      key={row.group.id}
                      row={row}
                      open={Boolean(openIds[row.group.id])}
                      onToggle={() =>
                        setOpenIds((prev) => ({
                          ...prev,
                          [row.group.id]: !prev[row.group.id],
                        }))
                      }
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
          {rows.length > CONTACT_HISTORY_PAGE ? (
            <p className="mt-3 text-sm text-ink-soft">
              1-{visible.length} of {rows.length}
            </p>
          ) : null}
          {remaining > 0 ? (
            <button
              type="button"
              data-contact-history-more=""
              onClick={() => setShown((n) => n + CONTACT_HISTORY_PAGE)}
              className={`${btnGhost} mt-3 w-full`}
            >
              View more
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function GroupPhone({
  row,
  open,
  onToggle,
}: {
  row: Extract<ContactHistoryRow, { kind: "group" }>;
  open: boolean;
  onToggle: () => void;
}) {
  const copy = contactHistoryGroupCopy(row.group);
  return (
    <li className="border-t border-line/70 first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-3 py-3 text-left ${deskShiftClass}`}
      >
        <span className="min-w-0 text-sm text-ink">{copy}</span>
        <InboxPurposeChip purpose={row.group.purpose} label={row.group.stamp} />
      </button>
      {open
        ? row.group.entries.map((entry) => <SinglePhone key={entry.id} entry={entry} />)
        : null}
    </li>
  );
}

function GroupTable({
  row,
  open,
  onToggle,
}: {
  row: Extract<ContactHistoryRow, { kind: "group" }>;
  open: boolean;
  onToggle: () => void;
}) {
  const copy = contactHistoryGroupCopy(row.group);
  return (
    <>
      <tr className="border-t border-line/70">
        <td colSpan={3} className="p-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className={`flex min-h-11 w-full items-center justify-between gap-3 px-5 py-4 text-left ${deskShiftClass}`}
          >
            <span className="min-w-0 text-sm text-ink">{copy}</span>
            <InboxPurposeChip purpose={row.group.purpose} label={row.group.stamp} />
          </button>
        </td>
      </tr>
      {open
        ? row.group.entries.map((entry) => <SingleTable key={entry.id} entry={entry} />)
        : null}
    </>
  );
}

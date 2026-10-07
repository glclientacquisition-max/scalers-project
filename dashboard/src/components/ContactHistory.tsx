"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ContactTimelineWhat } from "@/components/ContactTimelineWhat";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { btnGhost } from "@/components/ui/deskChrome";
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

function HistoryListRow({ entry }: { entry: ContactTimelineEntry }) {
  return (
    <ListRow
      href={entry.href || undefined}
      ariaLabel="Conversation"
      title={formatCallWhen(entry.createdAt)}
      preview={<ContactTimelineWhat headline={entry.headline} detail={entry.detail} />}
      stamp={<InboxPurposeChip purpose={entry.purpose} label={entry.stamp} />}
    />
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
      <h2 className="text-title text-ink">History</h2>
      <div className="mt-3">
        <Field id="contact-history-search" label="Search history">
          {(props) => (
            <Input
              {...props}
              type="search"
              value={value}
              placeholder="Search"
              onChange={(event) => {
                const next = event.currentTarget.value.slice(0, 64);
                setValue(next);
                syncQuery(next);
              }}
            />
          )}
        </Field>
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
        <div className="mt-8 border-y border-hairline py-8 text-center">
          <p className="text-title text-ink">
            {q.trim() ? "No matches" : filter === "all" ? "No calls or jobs yet" : "Nothing in this filter"}
          </p>
          {q.trim() ? (
            <button
              type="button"
              className={`${btnGhost} mt-6`}
              onClick={() => {
                setValue("");
                syncQuery("");
              }}
            >
              Clear
            </button>
          ) : filter !== "all" ? (
            <Link href={chipHrefs.all} className={`${btnGhost} mt-6`}>
              Show all
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {visible.map((row) =>
              row.kind === "single" ? (
                <HistoryListRow key={row.entry.id} entry={row.entry} />
              ) : (
                <GroupHistoryRow
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
          {rows.length > CONTACT_HISTORY_PAGE ? (
            <p className="mt-3 text-meta text-ink-2">
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

function GroupHistoryRow({
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
    <li className="bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-4 py-3 text-start"
      >
        <span className="min-w-0 text-body text-ink">{copy}</span>
        <InboxPurposeChip purpose={row.group.purpose} label={row.group.stamp} />
      </button>
      {open ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {row.group.entries.map((entry) => (
            <HistoryListRow key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

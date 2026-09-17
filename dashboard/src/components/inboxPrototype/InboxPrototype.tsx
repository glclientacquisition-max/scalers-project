"use client";

import { useMemo, useState } from "react";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import {
  btnGhost,
  btnPrimary,
  deskEmptyClass,
  deskFieldClass,
  filterTabClass,
  filterTabCountClass,
  pageTitleClass,
} from "@/components/ui/deskChrome";
import {
  RowIdentity,
  RowStateDot,
  deskRowWeightClass,
} from "@/components/ui/deskRow";
import { followUpWhatsAppMessage, formatCallWhenRelative } from "@/lib/callsTriage";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import {
  countInboxPurposes,
  itemMatchesPurpose,
  itemMatchesQuery,
  itemSignalLabel,
  type InboxItem,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import {
  PROTOTYPE_ITEMS,
  PROTOTYPE_TRANSCRIPTS,
} from "@/components/inboxPrototype/inboxPrototypeData";

const VERTICAL = "home_services";
const BUSINESS = "Scalers Cleaning";

function briefing(count: number): string {
  if (count === 0) return "Clear";
  if (count === 1) return "1 needs you";
  return `${count} need you`;
}

function workLine(item: InboxItem): string {
  if (item.job) {
    return item.job.when_text?.trim() || item.headline;
  }
  if (item.hold) {
    return item.headline;
  }
  return item.headline;
}

function metaLine(item: InboxItem): string {
  if (item.job) return item.job.address_landmark?.trim() || formatCallWhenRelative(item.createdAt);
  if (item.hold) return item.hold.when_text?.trim() || "Anytime";
  return formatCallWhenRelative(item.createdAt);
}

function primaryVerb(item: InboxItem): string {
  if (item.job && item.job.status === "requested") return "Confirm";
  if (item.hold && item.hold.status === "open") return "Done";
  if (item.purpose === "human" || item.purpose === "missed") return "Noted";
  return "Done";
}

export function InboxPrototype() {
  const copy = nicheCopy(VERTICAL);
  const filters = purposeFilters(VERTICAL);
  const [purpose, setPurpose] = useState<InboxPurposeFilterId>("needs");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("human-amina");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const items = useMemo(
    () =>
      PROTOTYPE_ITEMS.map((row) =>
        doneIds.has(row.id)
          ? {
              ...row,
              needsYou: false,
              job: row.job
                ? { ...row.job, status: row.job.status === "requested" ? "confirmed" : row.job.status }
                : row.job,
              hold: row.hold ? { ...row.hold, status: "fulfilled" } : row.hold,
            }
          : row
      ),
    [doneIds]
  );

  const searched = useMemo(
    () => items.filter((row) => itemMatchesQuery(row, query)),
    [items, query]
  );
  const counts = countInboxPurposes(searched);
  const rows = searched.filter((row) => itemMatchesPurpose(row, purpose));
  const selected = rows.find((row) => row.id === selectedId) || rows[0] || null;

  function openRow(id: string) {
    setSelectedId(id);
    setPhoneOpen(true);
  }

  function markDone(id: string) {
    setDoneIds((prev) => new Set(prev).add(id));
  }

  return (
    <div>
      <p className="mb-4 rounded-xl border border-line bg-accent-soft px-3 py-2 text-xs font-medium text-ink">
        Prototype. Live Inbox stays at /calls.
      </p>

      <header className="space-y-6">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className={pageTitleClass}>Inbox</h1>
            <p className="mt-1 text-[13px] text-ink-soft">{briefing(counts.needs)}</p>
          </div>
          <form
            className="flex w-full min-w-0 gap-2 sm:max-w-sm"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="sr-only" htmlFor="inbox-prototype-search">
              Search inbox
            </label>
            <input
              id="inbox-prototype-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              className={deskFieldClass}
            />
            <button type="submit" className={btnGhost}>
              Search
            </button>
          </form>
        </div>

        <nav aria-label="Filter by purpose" className="border-b border-line">
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]">
            {filters.map((item) => {
              const active = purpose === item.id;
              return (
                <li key={item.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setPurpose(item.id);
                      setPhoneOpen(false);
                    }}
                    className={filterTabClass(active)}
                  >
                    {item.label}
                    <span className={filterTabCountClass(active)}>{counts[item.id]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      {rows.length === 0 ? (
        <div className={deskEmptyClass}>
          <p className="font-display text-2xl tracking-tight text-ink">
            {query ? "No matches" : purpose === "needs" ? "Nothing needs you" : "Nothing in this filter"}
          </p>
          {query ? (
            <button type="button" className={`${btnGhost} mt-6`} onClick={() => setQuery("")}>
              Clear search
            </button>
          ) : (
            <button
              type="button"
              className={`${btnGhost} mt-6`}
              onClick={() => setPurpose("all")}
            >
              Show all
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.15fr)] lg:items-start">
          <section
            aria-label="Inbox list"
            className={phoneOpen ? "hidden lg:block" : "block"}
          >
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
              {rows.map((row) => {
                const isSelected = selected?.id === row.id;
                const who = row.callerName || row.callerPhone || "Caller";
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => openRow(row.id)}
                      aria-current={isSelected ? "true" : undefined}
                      className={[
                        "flex w-full items-center gap-3 border-t border-line/70 px-4 py-3 text-left first:border-t-0",
                        "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-inset",
                        isSelected ? "bg-accent-soft" : "hover:bg-accent/[0.04]",
                        row.urgent && !isSelected ? "bg-warn-soft/50" : "",
                      ].join(" ")}
                    >
                      <RowIdentity name={row.callerName} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p
                            className={`min-w-0 truncate text-sm tracking-tight ${deskRowWeightClass(row.needsYou)}`}
                          >
                            {who}
                          </p>
                          <p className="flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">
                            <RowStateDot show={row.needsYou} />
                            {formatCallWhenRelative(row.createdAt)}
                          </p>
                        </div>
                        <p
                          className={`mt-0.5 line-clamp-1 text-sm ${row.needsYou ? "text-ink" : "text-ink-soft"}`}
                        >
                          {workLine(row)}
                        </p>
                        <p className="mt-1">
                          <InboxPurposeChip
                            purpose={row.purpose}
                            label={itemSignalLabel(row, VERTICAL)}
                          />
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {selected ? (
            <InboxPrototypeDetail
              item={selected}
              phoneOpen={phoneOpen}
              onBack={() => setPhoneOpen(false)}
              onPrimary={() => markDone(selected.id)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function InboxPrototypeDetail({
  item,
  phoneOpen,
  onBack,
  onPrimary,
}: {
  item: InboxItem;
  phoneOpen: boolean;
  onBack: () => void;
  onPrimary: () => void;
}) {
  const stamp = itemSignalLabel(item, VERTICAL);
  const who = item.callerName || item.callerPhone || "Caller";
  const message = followUpWhatsAppMessage({
    businessName: BUSINESS,
    name: item.callerName,
    reason: item.headline,
  });
  const turns = PROTOTYPE_TRANSCRIPTS[item.id] || [];
  const verb = primaryVerb(item);

  return (
    <article
      aria-label="Inbox record"
      className={[
        "rounded-2xl border border-line bg-surface",
        phoneOpen ? "block" : "hidden lg:block",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          className={`${btnGhost} lg:hidden`}
        >
          Back
        </button>
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{who}</p>
        <p className="shrink-0 text-xs text-ink-soft">{formatCallWhenRelative(item.createdAt)}</p>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <section className="space-y-4 border-b border-line p-4 md:border-b-0 md:border-r sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">Summary</h2>
          <p className="font-display text-2xl tracking-tight text-ink">{stamp}</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Work</dt>
              <dd className="text-right font-medium text-ink">{workLine(item)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Needed</dt>
              <dd className="text-right text-ink">{metaLine(item)}</dd>
            </div>
            {item.job?.notes ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Note</dt>
                <dd className="text-right text-ink">{item.job.notes}</dd>
              </div>
            ) : null}
            {item.detail ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Detail</dt>
                <dd className="text-right text-ink">{item.detail}</dd>
              </div>
            ) : null}
          </dl>

          <div className="space-y-2 pt-2">
            {item.callerPhone ? (
              <WhatsAppLink
                number={item.callerPhone}
                message={message}
                variant="primary"
                label="Reply on WhatsApp"
                className="w-full"
              />
            ) : null}
            <button
              type="button"
              onClick={onPrimary}
              disabled={!item.needsYou}
              className={`${btnGhost} w-full`}
            >
              {verb}
            </button>
          </div>
        </section>

        <section className="space-y-3 p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">Call</h2>
          <div className="space-y-2">
            {turns.map((turn, index) => {
              const caller = turn.speaker === "caller";
              return (
                <div
                  key={`${item.id}-${index}`}
                  className={["flex", caller ? "justify-start" : "justify-end"].join(" ")}
                >
                  <p
                    className={[
                      "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      caller
                        ? "rounded-bl-md bg-bubble-caller text-ink"
                        : "rounded-br-md bg-surface-muted/90 text-ink",
                    ].join(" ")}
                  >
                    {turn.text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </article>
  );
}

"use client";

import type { AdminBillingRow } from "@/lib/adminBilling";
import type { BillingAttentionKind } from "@/lib/adminBillingHub";
import { cx } from "@/lib/cx";

export type NeedsCardDef = {
  kind: BillingAttentionKind;
  label: string;
  hint: string;
  count: number;
};

type Props = {
  cards: NeedsCardDef[];
  active: BillingAttentionKind | null;
  onSelect: (kind: BillingAttentionKind) => void;
};

/** Hick's level 2: pick one exception queue before seeing shops. */
export function AdminBillingNeedsCards({ cards, active, onSelect }: Props) {
  return (
    <div className="grid gap-3 px-4 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="Needs you queues">
      {cards.map((card) => (
        <NeedsCard
          key={card.kind}
          card={card}
          selected={active === card.kind}
          onPress={() => onSelect(card.kind)}
        />
      ))}
    </div>
  );
}

function NeedsCard({
  card,
  selected,
  onPress,
}: {
  card: NeedsCardDef;
  selected: boolean;
  onPress: () => void;
}) {
  const empty = card.count === 0;
  return (
    <button
      type="button"
      role="listitem"
      disabled={empty && card.kind !== "all"}
      onClick={onPress}
      aria-pressed={selected}
      className={cx(
        "rounded-2xl border px-4 py-4 text-start transition-[border-color,background-color,box-shadow] duration-fast ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        empty && card.kind !== "all"
          ? "border-hairline/50 bg-surface-2/30 text-ink-3"
          : selected
            ? "border-brand bg-surface-2/80 shadow-sm"
            : "border-hairline/70 bg-surface hover:bg-surface-2/50",
      )}
    >
      <p
        className={cx(
          "text-page tabular-nums leading-none",
          empty && card.kind !== "all" ? "text-ink-3" : card.count > 0 ? "text-ink" : "text-ink-2",
        )}
      >
        {card.count}
      </p>
      <p className="mt-2 text-body font-medium text-ink">{card.label}</p>
      <p className="mt-1 text-meta text-ink-2">{card.hint}</p>
    </button>
  );
}

export function buildNeedsCards(needs: AdminBillingRow[]): NeedsCardDef[] {
  const noPackage = needs.filter((r) => !r.packageName).length;
  const low = needs.filter((r) => r.status === "low_minutes").length;
  const exhausted = needs.filter((r) => r.status === "exhausted").length;

  return [
    { kind: "no_package", label: "No package", hint: "Assign in shop Money", count: noPackage },
    { kind: "low_minutes", label: "Low minutes", hint: "Grant or upgrade", count: low },
    { kind: "exhausted", label: "Exhausted", hint: "Grant or check opt-in", count: exhausted },
    { kind: "all", label: "All needs", hint: "Every queue combined", count: needs.length },
  ];
}

"use client";

import type { AdminBillingRow } from "@/lib/adminBillingTypes";
import type { BillingAttentionKind } from "@/lib/adminBillingHub";
import { cx } from "@/lib/cx";

export type FilterChipDef = {
  kind: Exclude<BillingAttentionKind, "all">;
  noun: string;
  count: number;
};

type Props = {
  chips: FilterChipDef[];
  active: BillingAttentionKind | null;
  onSelect: (kind: FilterChipDef["kind"]) => void;
};

/** Count + noun. Filters the list already on the page. */
export function AdminBillingFilterChips({ chips, active, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2 px-4" role="group" aria-label="Shop waits">
      {chips.map((chip) => (
        <FilterChip
          key={chip.kind}
          chip={chip}
          selected={active === chip.kind}
          onPress={() => onSelect(chip.kind)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  chip,
  selected,
  onPress,
}: {
  chip: FilterChipDef;
  selected: boolean;
  onPress: () => void;
}) {
  const empty = chip.count === 0;
  return (
    <button
      type="button"
      disabled={empty && !selected}
      onClick={onPress}
      aria-pressed={selected}
      aria-label={`${chip.count} ${chip.noun}`}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-body transition-[border-color,background-color,color] duration-fast ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        empty && !selected
          ? "border-hairline/50 text-ink-3"
          : selected
            ? "border-brand bg-surface-2 text-ink"
            : "border-hairline bg-surface text-ink hover:bg-surface-2",
      )}
    >
      <span className="tabular-nums font-medium">{chip.count}</span>
      <span>{chip.noun}</span>
    </button>
  );
}

export function buildFilterChips(
  needs: AdminBillingRow[],
  rolloverSoonCount: number,
): FilterChipDef[] {
  const chips: FilterChipDef[] = [
    { kind: "no_package", noun: "No plan", count: needs.filter((r) => !r.packageName).length },
    { kind: "low_minutes", noun: "Low", count: needs.filter((r) => r.status === "low_minutes").length },
    { kind: "exhausted", noun: "Out", count: needs.filter((r) => r.status === "exhausted").length },
  ];
  if (rolloverSoonCount > 0) {
    chips.push({ kind: "rollover_soon", noun: "Ending", count: rolloverSoonCount });
  }
  return chips;
}

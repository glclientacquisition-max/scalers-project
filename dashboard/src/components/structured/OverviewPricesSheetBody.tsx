"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/Segmented";
import { Chips } from "@/components/structured/Chips";
import type { PriceToConfirm } from "@/components/structured/PriceConfirmCards";
import { PRICING_MODES, UNITS, spokenPrice, type PricingMode, type StructuredPrice } from "@/lib/structuredData";

const PRODUCT_UNITS = ["item", "pack", "kg", "litre", "metre"];
const SERVICE_UNITS = ["job", "visit", "hour", "room", "sqm", "seat"];

function digits(v: string) {
  return v.replace(/\D/g, "").slice(0, 9);
}

function updateItem(items: PriceToConfirm[], index: number, pricing: StructuredPrice): PriceToConfirm[] {
  return items.map((row, i) => (i === index ? { ...row, pricing } : row));
}

/** Editable list of imported catalogue prices inside the Overview sheet. */
export function OverviewPricesSheetBody({
  items,
  onChange,
}: {
  items: PriceToConfirm[];
  onChange: (next: PriceToConfirm[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(items.length === 1 ? 0 : null);

  return (
    <ul className="divide-y divide-hairline rounded-2xl border border-hairline">
      {items.map((item, index) => {
        const shown = spokenPrice(item.pricing, item.text);
        const wrote = item.text.trim();
        const open = editing === index;
        return (
          <li key={`${item.kind}:${item.id || item.name}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-ink">{item.name}</p>
                <p className="text-meta text-ink-2">
                  <span className="tabular-nums">{shown}</span>
                  {wrote && wrote.toLowerCase() !== shown.trim().toLowerCase() ? (
                    <span> · from &ldquo;{wrote}&rdquo;</span>
                  ) : null}
                </p>
              </div>
              {items.length > 1 ? (
                <Button variant="tonal" size="sm" onClick={() => setEditing(open ? null : index)}>
                  {open ? "Done" : "Edit"}
                </Button>
              ) : null}
            </div>
            {open ? (
              <div className="mt-4">
                <PriceFields
                  item={item}
                  live={items.length === 1}
                  onPricing={(pricing) => onChange(updateItem(items, index, pricing))}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PriceFields({
  item,
  live,
  onPricing,
}: {
  item: PriceToConfirm;
  live: boolean;
  onPricing: (p: StructuredPrice) => void;
}) {
  const [mode, setMode] = useState<PricingMode>(item.pricing.mode);
  const [amount, setAmount] = useState(item.pricing.amount_ksh != null ? String(item.pricing.amount_ksh) : "");
  const [max, setMax] = useState(item.pricing.max_ksh != null ? String(item.pricing.max_ksh) : "");
  const [unit, setUnit] = useState<string[]>(item.pricing.unit ? [item.pricing.unit] : []);
  const [error, setError] = useState<{ amount?: string; max?: string }>({});

  function build(): StructuredPrice | null {
    const lo = amount ? Number(amount) : null;
    const hi = max ? Number(max) : null;
    const e: { amount?: string; max?: string } = {};
    if (mode !== "ask" && lo == null) e.amount = "Add the price in KSh.";
    if (mode === "range" && (hi == null || lo == null || hi < lo)) e.max = "The top of the range must be higher.";
    setError(e);
    if (Object.keys(e).length) return null;
    return {
      mode,
      amount_ksh: mode === "ask" ? null : lo,
      min_ksh: mode === "from" || mode === "range" ? lo : null,
      max_ksh: mode === "range" ? hi : null,
      unit: unit[0] ?? null,
      in_stock: item.pricing.in_stock,
      source: "owner",
      confirmed: true,
    };
  }

  function apply() {
    const next = build();
    if (next) onPricing(next);
  }

  useEffect(() => {
    if (!live) return;
    const next = build();
    if (next) onPricing(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- live sync for single-item sheet
  }, [live, mode, amount, max, unit.join(",")]);

  return (
    <div className="space-y-4">
      <SegmentedControl
        label="How it's priced"
        value={mode}
        onChange={(v) => setMode(v as PricingMode)}
        items={PRICING_MODES.map((m) => ({ value: m.id, label: m.label }))}
      />
      {mode !== "ask" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ov-price-amount" label={mode === "range" ? "From (KSh)" : "Price (KSh)"} error={error.amount}>
            {(a) => (
              <Input {...a} inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} placeholder="e.g. 2500" />
            )}
          </Field>
          {mode === "range" ? (
            <Field id="ov-price-max" label="To (KSh)" error={error.max}>
              {(a) => <Input {...a} inputMode="numeric" value={max} onChange={(e) => setMax(digits(e.target.value))} placeholder="e.g. 4000" />}
            </Field>
          ) : null}
        </div>
      ) : (
        <p className="text-meta text-ink-2">Your Business Assistant takes the caller&apos;s details and you confirm the price.</p>
      )}
      {mode !== "ask" ? (
        <div className="space-y-2">
          <p className="text-meta font-medium text-ink">Per</p>
          <Chips<string>
            label="Price per"
            options={UNITS.filter((u) => (item.kind === "product" ? PRODUCT_UNITS : SERVICE_UNITS).includes(u.id))}
            value={unit}
            onChange={setUnit}
          />
        </div>
      ) : null}
      {!live ? (
        <Button variant="tonal" size="sm" onClick={apply}>Apply</Button>
      ) : null}
    </div>
  );
}

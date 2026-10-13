"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { notify } from "@/components/ui/DeskNotice";
import { SettingsGroup } from "@/components/settingsUi";
import { PRICING_MODES, UNITS, priceLabel, type PricingMode, type StructuredPrice } from "@/lib/structuredData";
import type { StructuredResult } from "@/app/(desk)/settings/structuredActions";
import { Chips } from "./Chips";

export type PriceToConfirm = { kind: "product" | "service"; id?: string | null; name: string; pricing: StructuredPrice; text: string };

type SaveFn = (input: { kind: "product" | "service"; id?: string | null; name: string; pricing: StructuredPrice }) => Promise<StructuredResult>;

const SHOWN = 5;
const PRODUCT_UNITS = ["item", "pack", "kg", "litre", "metre"];
const SERVICE_UNITS = ["job", "visit", "hour", "room", "sqm", "seat"];

/** "Is this right?" for prices read from old text. Yes keeps it; Change opens a bottom sheet. */
export function PriceConfirmCards({ items, save, canEdit }: { items: PriceToConfirm[]; save: SaveFn; canEdit: boolean }) {
  const [done, setDone] = useState<string[]>([]);
  const [editing, setEditing] = useState<PriceToConfirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const left = items.filter((i) => !done.includes(`${i.kind}:${i.id || i.name}`));
  if (!left.length) return null;

  function run(item: PriceToConfirm, pricing: StructuredPrice, after?: () => void) {
    const key = `${item.kind}:${item.id || item.name}`;
    setBusy(key);
    start(async () => {
      const res = await save({ kind: item.kind, id: item.id ?? null, name: item.name, pricing });
      setBusy(null);
      notify(res.ok ? res.message : res.error);
      if (res.ok) {
        setDone((d) => [...d, key]);
        after?.();
      }
    });
  }

  return (
    <SettingsGroup title={`Check ${left.length} price${left.length === 1 ? "" : "s"}`}>
      <p className="px-4 pt-3 text-meta text-ink-2">We read these from your price notes. Is each one right?</p>
      <ul aria-label="Prices to check">
        {left.slice(0, SHOWN).map((item) => {
          const key = `${item.kind}:${item.id || item.name}`;
          return (
            <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <p className="truncate text-body text-ink">{item.name}</p>
                <p className="text-meta text-ink-2">
                  <span className="tabular-nums">{priceLabel(item.pricing)}</span>
                  {item.text && item.text.trim().toLowerCase() !== priceLabel(item.pricing).toLowerCase() ? <span> · from &ldquo;{item.text}&rdquo;</span> : null}
                </p>
              </div>
              {canEdit ? (
                <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
                  <Button variant="tonal" size="sm" disabled={pending} pending={busy === key}
                    aria-label={`Yes, ${item.name} is ${priceLabel(item.pricing)}`} onClick={() => run(item, item.pricing)}>
                    Yes
                  </Button>
                  <Button variant="ghost" size="sm" disabled={pending} aria-label={`Change the price of ${item.name}`} onClick={() => setEditing(item)}>
                    Change
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {left.length > SHOWN ? <p className="px-4 py-3 text-meta text-ink-2">{left.length - SHOWN} more after these.</p> : null}
      {editing ? (
        <PriceSheet item={editing} pending={pending} onClose={() => setEditing(null)} onSave={(pricing) => run(editing, pricing, () => setEditing(null))} />
      ) : null}
    </SettingsGroup>
  );
}

function PriceSheet({
  item,
  pending,
  onClose,
  onSave,
}: {
  item: PriceToConfirm;
  pending: boolean;
  onClose: () => void;
  onSave: (p: StructuredPrice) => void;
}) {
  const [mode, setMode] = useState<PricingMode>(item.pricing.mode);
  const [amount, setAmount] = useState(item.pricing.amount_ksh != null ? String(item.pricing.amount_ksh) : "");
  const [max, setMax] = useState(item.pricing.max_ksh != null ? String(item.pricing.max_ksh) : "");
  const [unit, setUnit] = useState<string[]>(item.pricing.unit ? [item.pricing.unit] : []);
  const [error, setError] = useState<{ amount?: string; max?: string }>({});
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 9);

  function submit() {
    const lo = amount ? Number(amount) : null;
    const hi = max ? Number(max) : null;
    const e: { amount?: string; max?: string } = {};
    if (mode !== "ask" && lo == null) e.amount = "Add the price in KSh.";
    if (mode === "range" && (hi == null || lo == null || hi < lo)) e.max = "The top of the range must be higher.";
    setError(e);
    if (Object.keys(e).length) return;
    onSave({
      mode,
      amount_ksh: mode === "ask" ? null : lo,
      min_ksh: mode === "from" || mode === "range" ? lo : null,
      max_ksh: mode === "range" ? hi : null,
      unit: unit[0] ?? null,
      in_stock: item.pricing.in_stock,
      source: "owner",
      confirmed: true,
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={item.name}
      description="Set the price callers hear."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={pending} onClick={submit}>Save price</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <SegmentedControl label="How it's priced" value={mode} onChange={(v) => setMode(v as PricingMode)}
          items={PRICING_MODES.map((m) => ({ value: m.id, label: m.label }))} />
        {mode !== "ask" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="price-amount" label={mode === "range" ? "From (KSh)" : "Price (KSh)"} error={error.amount}>
              {(a) => <Input {...a} inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} placeholder="e.g. 2500" />}
            </Field>
            {mode === "range" ? (
              <Field id="price-max" label="To (KSh)" error={error.max}>
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
            <Chips<string> label="Price per" options={UNITS.filter((u) => (item.kind === "product" ? PRODUCT_UNITS : SERVICE_UNITS).includes(u.id))} value={unit} onChange={setUnit} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

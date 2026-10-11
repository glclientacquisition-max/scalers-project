"use client";

import { useRef, useState } from "react";
import { SegmentedControl } from "@/components/ui/Segmented";
import { HOME_SUGGESTED_SERVICES, SHOP_SUGGESTED_PRODUCTS } from "@/lib/catalogSeeds";
import { parseProductCsv } from "@/lib/productCatalog";
import {
  emptyRow,
  LIMITS,
  priceText,
  rowFromImport,
  type CatalogueRow,
  type CatalogueStep as Value,
  type FieldErrors,
  type PriceMode,
  type Vertical,
} from "@/lib/setupFlow";
import { FieldError, TextButton, inputClass } from "./ui";

const MODES: Array<{ value: PriceMode; label: string }> = [
  { value: "fixed", label: "Fixed" },
  { value: "from", label: "From" },
  { value: "range", label: "Range" },
  { value: "ask", label: "Ask" },
];

const MAX_FILE_BYTES = 1_000_000;

export function CatalogueStep({
  value,
  onChange,
  errors,
  vertical,
}: {
  value: Value;
  onChange: (v: Value) => void;
  errors: FieldErrors;
  vertical: Vertical;
}) {
  const home = vertical === "home_services";
  const noun = home ? "service" : "product";
  const suggestions = (home ? HOME_SUGGESTED_SERVICES.slice(0, 5) : SHOP_SUGGESTED_PRODUCTS) as readonly string[];
  const [importNote, setImportNote] = useState<string | null>(null);
  const lastAdded = useRef<number | null>(null);
  const rows = value.rows;

  const set = (next: CatalogueRow[]) => onChange({ skipped: false, rows: next });
  const update = (i: number, patch: Partial<CatalogueRow>) => set(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (name = "") => {
    if (rows.length >= LIMITS.rows) return;
    lastAdded.current = rows.length;
    set([...rows, emptyRow(name)]);
  };
  const remove = (i: number) => set(rows.filter((_, j) => j !== i));
  const has = (name: string) => rows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase());

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setImportNote("That file is over 1 MB. Split it, or add the rest in Settings later.");
      return;
    }
    const parsed = parseProductCsv(await file.text());
    if (!parsed.length) {
      setImportNote("We couldn't read that file. Use a CSV with a name column and a price column.");
      return;
    }
    const room = LIMITS.rows - rows.length;
    const incoming = parsed
      .filter((p) => p.name && !has(p.name))
      .slice(0, Math.max(0, room))
      .map((p) => rowFromImport(p.name, p.price, p.notes, p.category));
    set([...rows, ...incoming]);
    const dropped = parsed.length - incoming.length;
    setImportNote(
      `Added ${incoming.length} ${incoming.length === 1 ? "item" : "items"}.` +
        (dropped > 0 ? ` Skipped ${dropped} (duplicates or over the ${LIMITS.rows}-item limit).` : "") +
        " Check the prices below."
    );
  }

  return (
    <>
      <div className="mt-6">
        <p className="px-4 text-meta text-ink-2">Quick add</p>
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              disabled={has(name)}
              onClick={() => add(name)}
              className="min-h-11 rounded-full bg-surface px-4 text-meta font-medium text-ink hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <ol className="mt-6 space-y-4" aria-label={home ? "Services" : "Products"}>
        {rows.map((row, i) => {
          const e = (f: string) => errors[`rows.${i}.${f}`];
          const id = (f: string) => `row-${i}-${f}`;
          const preview = priceText(row);
          return (
            <li key={i} className="rounded-2xl bg-surface p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={id("name")} className="sr-only">
                    {home ? "Service" : "Product"} name
                  </label>
                  <input
                    id={id("name")}
                    data-field={`rows.${i}.name`}
                    value={row.name}
                    maxLength={LIMITS.name}
                    autoFocus={lastAdded.current === i && !row.name}
                    onChange={(ev) => update(i, { name: ev.target.value })}
                    placeholder={home ? "Service name" : "Product name"}
                    aria-invalid={e("name") ? true : undefined}
                    aria-describedby={e("name") ? id("name-err") : undefined}
                    className={`${inputClass} font-medium`}
                  />
                  <FieldError id={id("name-err")} message={e("name")} />
                </div>
                <TextButton tone="danger" onClick={() => remove(i)} label={`Remove ${row.name || `item ${i + 1}`}`}>
                  Remove
                </TextButton>
              </div>

              <p className="mb-2 mt-4 text-meta font-medium text-ink" id={id("mode-label")}>
                How you charge
              </p>
              <SegmentedControl
                label={`How you charge for ${row.name || `item ${i + 1}`}`}
                value={row.pricing_mode || "fixed"}
                onChange={(m) => update(i, { pricing_mode: m as PriceMode })}
                items={MODES}
                className="w-full"
              />

              {row.pricing_mode !== "ask" ? (
                <div className="mt-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id("price")} className="mb-1.5 block text-meta text-ink-2">
                      {row.pricing_mode === "range" ? "Lowest" : row.pricing_mode === "from" ? "Starting at" : "Price"} (KSh)
                    </label>
                    <input
                      id={id("price")}
                      data-field={`rows.${i}.price`}
                      value={row.price}
                      inputMode="decimal"
                      maxLength={12}
                      onChange={(ev) => update(i, { price: ev.target.value })}
                      placeholder="1500"
                      aria-invalid={e("price") ? true : undefined}
                      aria-describedby={e("price") ? id("price-err") : undefined}
                      className={`${inputClass} tabular-nums`}
                    />
                    <FieldError id={id("price-err")} message={e("price")} />
                  </div>
                  {row.pricing_mode === "range" ? (
                    <div className="min-w-0 flex-1">
                      <label htmlFor={id("price_max")} className="mb-1.5 block text-meta text-ink-2">
                        Highest (KSh)
                      </label>
                      <input
                        id={id("price_max")}
                        data-field={`rows.${i}.price_max`}
                        value={row.price_max}
                        inputMode="decimal"
                        maxLength={12}
                        onChange={(ev) => update(i, { price_max: ev.target.value })}
                        placeholder="3000"
                        aria-invalid={e("price_max") ? true : undefined}
                        aria-describedby={e("price_max") ? id("price_max-err") : undefined}
                        className={`${inputClass} tabular-nums`}
                      />
                      <FieldError id={id("price_max-err")} message={e("price_max")} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-meta text-ink-2">Your receptionist will say the price depends on the job and take the caller&apos;s details.</p>
              )}

              {home ? (
                <>
                  <p className="mb-2 mt-4 text-meta font-medium text-ink">Visit before quoting?</p>
                  <SegmentedControl
                    label={`Visit before quoting ${row.name || `item ${i + 1}`}`}
                    value={row.site_visit}
                    onChange={(v) => update(i, { site_visit: v as "yes" | "no" })}
                    items={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                    ]}
                    className="w-full"
                  />
                  <span data-field={`rows.${i}.site_visit`} />
                  <FieldError id={id("visit-err")} message={e("site_visit")} />
                </>
              ) : null}

              {preview ? <p className="mt-3 text-meta text-ink-2">Callers hear: {preview}</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => add()}
          disabled={rows.length >= LIMITS.rows}
          className="min-h-11 rounded-xl bg-surface px-4 text-body font-medium text-accent-deep hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Add {rows.length ? `another ${noun}` : `a ${noun}`}
        </button>
        {!home ? (
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl px-4 text-body font-medium text-ink-2 hover:bg-surface focus-within:ring-2 focus-within:ring-brand">
            Import CSV
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(ev) => { void onFile(ev.target.files?.[0]); ev.target.value = ""; }} />
          </label>
        ) : null}
      </div>
      {importNote ? (
        <p role="status" className="mt-2 px-1 text-meta text-ink-2">
          {importNote}
        </p>
      ) : null}
      <p className="mt-4 px-1 text-meta text-ink-2">One item with a price is enough to start. Add the rest any time in Settings.</p>
    </>
  );
}

"use client";

import { SegmentedControl } from "@/components/ui/Segmented";
import {
  type PriceKind,
  validateCatalogPriceFields,
} from "@/lib/catalogPriceKind";
import { cx } from "@/lib/cx";

const MODES: Array<{ value: PriceKind; label: string }> = [
  { value: "fixed", label: "Fixed" },
  { value: "from", label: "From" },
  { value: "range", label: "Range" },
  { value: "quote", label: "Quote on request" },
];

type Props = {
  idPrefix: string;
  kind: PriceKind;
  minInput: string;
  maxInput: string;
  onKindChange: (kind: PriceKind) => void;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  fieldClass: string;
  labelClass?: string;
  /** Server or client validation messages keyed min / max */
  errors?: { min?: string; max?: string };
};

export function CatalogPriceEditor({
  idPrefix,
  kind,
  minInput,
  maxInput,
  onKindChange,
  onMinChange,
  onMaxChange,
  fieldClass,
  labelClass = "mb-1 block text-meta text-ink-2",
  errors,
}: Props) {
  const local = validateCatalogPriceFields(kind, minInput, maxInput);
  const minError = errors?.min ?? local.min;
  const maxError = errors?.max ?? local.max;

  const stripNonDigits = (raw: string) => raw.replace(/[^\d,]/g, "");

  return (
    <div className="col-span-full space-y-2">
      <p className="text-meta font-medium text-ink" id={`${idPrefix}-kind-label`}>
        Price
      </p>
      <SegmentedControl
        label="Price type"
        value={kind}
        onChange={(v) => onKindChange(v as PriceKind)}
        items={MODES.map((m) => ({ value: m.value, label: m.label }))}
        className="grid w-full !grid-cols-2 lg:!inline-grid lg:!auto-cols-fr lg:!grid-flow-col"
      />
      {kind === "quote" ? (
        <p className="text-meta text-ink-2">
          Not sure of the price? Pick Quote on request and the Business Assistant will arrange a callback.
        </p>
      ) : (
        <div className={cx("grid gap-2", kind === "range" ? "grid-cols-2" : "grid-cols-1")}>
          <div className="min-w-0">
            <label className={labelClass} htmlFor={`${idPrefix}-min`}>
              {kind === "range" ? "Lowest (KSh)" : kind === "from" ? "Starting at (KSh)" : "Amount (KSh)"}
            </label>
            <input
              id={`${idPrefix}-min`}
              value={minInput}
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              onChange={(e) => onMinChange(stripNonDigits(e.target.value))}
              placeholder={kind === "from" ? "1500" : "2000"}
              aria-invalid={minError ? true : undefined}
              aria-describedby={minError ? `${idPrefix}-min-err` : undefined}
              className={cx(fieldClass, "tabular-nums")}
            />
            {minError ? (
              <p id={`${idPrefix}-min-err`} className="mt-1 text-meta text-warn" role="alert">
                {minError}
              </p>
            ) : null}
          </div>
          {kind === "range" ? (
            <div className="min-w-0">
              <label className={labelClass} htmlFor={`${idPrefix}-max`}>
                Highest (KSh)
              </label>
              <input
                id={`${idPrefix}-max`}
                value={maxInput}
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                onChange={(e) => onMaxChange(stripNonDigits(e.target.value))}
                placeholder="800"
                aria-invalid={maxError ? true : undefined}
                aria-describedby={maxError ? `${idPrefix}-max-err` : undefined}
                className={cx(fieldClass, "tabular-nums")}
              />
              {maxError ? (
                <p id={`${idPrefix}-max-err`} className="mt-1 text-meta text-warn" role="alert">
                  {maxError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

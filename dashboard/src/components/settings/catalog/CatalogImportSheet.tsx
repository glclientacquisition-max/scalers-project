"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";
import type { CatalogSuggestMeta } from "@/lib/catalogSuggest";

type PreviewRow = (ServiceItem | ProductItem) & CatalogSuggestMeta;

/** Plain-text exports only; a spreadsheet needs "Save as CSV" first. */
const FILE_ACCEPT = ".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";
const FILE_MAX_BYTES = 1_000_000;

export function CatalogImportSheet({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  text,
  onTextChange,
  previewRows,
  onApply,
  applyLabel,
  warningsFor,
  updateExisting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  text: string;
  onTextChange: (value: string) => void;
  previewRows: PreviewRow[];
  onApply: () => void;
  applyLabel: string;
  /** Short per-row notes for the preview, e.g. "No price". */
  warningsFor?: (row: PreviewRow) => string[];
  /** "Update prices of existing items": same name (any case) takes the pasted price. */
  updateExisting?: { checked: boolean; onChange: (next: boolean) => void };
}) {
  const cleanupCount = previewRows.filter((row) => row.changed).length;
  const warnCount = warningsFor ? previewRows.filter((row) => warningsFor(row).length).length : 0;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) return setFileNote("That file is too large. Keep it under 1 MB, or paste the rows.");
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) return setFileNote("Save the sheet as CSV first, then choose it here.");
    onTextChange(await file.text());
    setFileNote(`Read ${file.name}.`);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onTextChange("");
          setFileNote(null);
        }
        onOpenChange(next);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!previewRows.length}
            onClick={() => {
              onApply();
              onTextChange("");
              onOpenChange(false);
            }}
          >
            {applyLabel}
          </Button>
        </>
      }
    >
      <label className="sr-only" htmlFor="catalog-import-paste">
        Paste list
      </label>
      <textarea
        id="catalog-import-paste"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={4}
        placeholder={placeholder}
        className="min-h-[7rem] w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-body text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-brand"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void readFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="tonal" size="md" onClick={() => fileRef.current?.click()}>
          Choose a file
        </Button>
        <p className="min-w-0 flex-1 text-meta text-ink-2" role="status">
          {fileNote ?? "CSV or text file"}
        </p>
      </div>
      {updateExisting ? (
        <div className="mt-3 flex min-h-12 items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-ink">Update prices of existing items</p>
            <p className="mt-0.5 text-meta text-ink-2">Items with the same name get the new price. Nothing is removed.</p>
          </div>
          <Switch checked={updateExisting.checked} onCheckedChange={updateExisting.onChange} label="Update prices of existing items" />
        </div>
      ) : null}
      {previewRows.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-meta text-ink-2">
            {cleanupCount
              ? `Suggested cleanup on ${cleanupCount} row${cleanupCount === 1 ? "" : "s"}`
              : `Ready to add ${previewRows.length} row${previewRows.length === 1 ? "" : "s"}`}
            {warnCount ? ` · ${warnCount} to check` : ""}
          </p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {previewRows.slice(0, 8).map((row, i) => (
              <li key={`${row.name}-${i}`} className="px-4 py-2.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-body font-medium text-ink">{row.name}</p>
                  {warningsFor?.(row).length ? (
                    <span className="shrink-0 rounded-md bg-attention-tonal px-1.5 text-meta font-medium text-attention">
                      {warningsFor(row).join(" · ")}
                    </span>
                  ) : null}
                </div>
                {"price_range" in row && row.price_range ? (
                  <p className="truncate text-meta text-ink-2">{row.price_range}</p>
                ) : null}
                {"price" in row && row.price ? (
                  <p className="truncate text-meta text-ink-2">{row.price}</p>
                ) : null}
              </li>
            ))}
            {previewRows.length > 8 ? (
              <li className="px-4 py-2.5 text-meta text-ink-2">+{previewRows.length - 8} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

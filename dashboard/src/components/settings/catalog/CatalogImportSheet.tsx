"use client";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";
import type { CatalogSuggestMeta } from "@/lib/catalogSuggest";

type PreviewRow = (ServiceItem | ProductItem) & CatalogSuggestMeta;

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
}) {
  const cleanupCount = previewRows.filter((row) => row.changed).length;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onTextChange("");
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
      {previewRows.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-meta text-ink-2">
            {cleanupCount
              ? `Suggested cleanup on ${cleanupCount} row${cleanupCount === 1 ? "" : "s"}`
              : `Ready to add ${previewRows.length} row${previewRows.length === 1 ? "" : "s"}`}
          </p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {previewRows.slice(0, 8).map((row, i) => (
              <li key={`${row.name}-${i}`} className="px-4 py-2.5">
                <p className="truncate text-body font-medium text-ink">{row.name}</p>
                {"price_range" in row && row.price_range ? (
                  <p className="truncate text-meta text-ink-2">{row.price_range}</p>
                ) : null}
                {"price" in row && row.price ? (
                  <p className="truncate text-meta text-ink-2">{row.price}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

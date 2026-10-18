"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { catalogImportPriceLabel } from "@/lib/catalogPricingMode";
import { productImportWarnings, type ProductItem } from "@/lib/productCatalog";
import type { SocialHandles } from "@/lib/socialHandles";
import { socialHandlesHaveContent } from "@/lib/socialHandles";
import {
  applyCatalogImportAction,
  previewCatalogImportAction,
  type CatalogImportState,
} from "@/app/(desk)/settings/catalogActions";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  ToolSwitch,
  settingsActionClass,
  settingsBlockTitleClass,
  settingsFieldClass,
  settingsPrimaryButtonClass,
  compactTextareaExpandHandlers,
} from "@/components/settingsUi";

const fieldClass = settingsFieldClass;

const initial: CatalogImportState = {};

type Mode = "paste" | "csv" | "url";
type MergeMode = "merge" | "update" | "replace";

/** Plain-text exports only; a spreadsheet's own format would need its app to save as CSV. */
const FILE_ACCEPT = ".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";
const FILE_MAX_BYTES = 1_000_000;

const MERGE_HINT: Record<MergeMode, string> = {
  merge: "New items are added. Items you already have stay as they are.",
  update: "Items with the same name get the new price. New items are added. Nothing is removed.",
  replace: "Your product list becomes only what is ticked here.",
};

function CatalogImportPanelInner({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("paste");
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [products, setProducts] = useState<ProductItem[] | null>(null);
  const [social, setSocial] = useState<SocialHandles | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mergeMode, setMergeMode] = useState<MergeMode>("merge");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) {
      setFileNote("That file is too large. Keep it under 1 MB, or paste the rows.");
      return;
    }
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) {
      setFileNote("Save the sheet as CSV first, then choose it here.");
      return;
    }
    setPaste(await file.text());
    setFileNote(`Read ${file.name}. Check the text, then scan.`);
  }
  const [includeSocial, setIncludeSocial] = useState(false);
  // Preview result the owner already finished with (Start over / applied): never re-show its message.
  const [dismissed, setDismissed] = useState<CatalogImportState | null>(null);

  const [previewState, previewAction, previewPending] = useActionState(
    previewCatalogImportAction,
    initial
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyCatalogImportAction,
    initial
  );

  useEffect(() => {
    if (previewState.ok && previewState.products) {
      setProducts(previewState.products);
      setSelected(new Set(previewState.products.map((_, i) => i)));
      if (previewState.social) {
        setSocial(previewState.social);
      setIncludeSocial(
          Boolean(
            previewState.social &&
              socialHandlesHaveContent(previewState.social)
          )
        );
      }
    }
  }, [previewState]);

  useEffect(() => {
    if (applyState.ok) {
      setDismissed(previewState);
      setProducts(null);
      setPaste("");
      setUrl("");
      router.refresh();
    }
  }, [applyState, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProducts = useMemo(() => {
    if (!products) return [];
    return [...selected]
      .sort((a, b) => a - b)
      .map((i) => products[i])
      .filter(Boolean);
  }, [products, selected]);

  const flash =
    applyState.error ||
    applyState.message ||
    (!products
      ? previewState === dismissed
        ? null
        : previewState.error || (previewState.ok && !previewState.products?.length ? previewState.message : null)
      : previewState.error);
  const flashIsError = Boolean(applyState.error || previewState.error);

  return (
    <section className="space-y-4">
      <p className={settingsBlockTitleClass}>Products</p>

      {!products ? (
        <div className="space-y-3">
          <SettingsSegmented
            label="Catalogue source"
            value={mode}
            options={
              [
                { id: "paste" as const, label: "Text" },
                { id: "url" as const, label: "URL" },
                { id: "csv" as const, label: "CSV" },
              ] as const
            }
            onChange={setMode}
          />

          <form action={previewAction} className="space-y-3">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="source_mode" value={mode} />
            {mode === "url" ? (
              <div className="flex flex-col gap-1.5">
                <label className="block text-body font-medium" htmlFor="catalog_url">
                  Catalogue page URL
                </label>
                <input
                  id="catalog_url"
                  name="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yourshop.co.ke/shop"
                  className={`${fieldClass} mt-0`}
                />
                <div className="flex justify-end self-end">
                  <button
                    type="submit"
                    disabled={previewPending}
                    className={settingsActionClass}
                  >
                    {previewPending ? "Scanning…" : "Scan"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="block text-body font-medium" htmlFor="catalog_paste">
                  {mode === "csv" ? "CSV" : "Text"}
                </label>
                <textarea
                  id="catalog_paste"
                  name="paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={2}
                  {...compactTextareaExpandHandlers}
                  placeholder={
                    mode === "csv"
                      ? "name,price,category,in_stock,sku\nA4 paper,500 KES,Paper,yes,\nBinding,300 KES,Print,yes,"
                      : "A4 paper - 500 KES\nBinding - 300 KES"
                  }
                  className={`${fieldClass} mt-0 text-body leading-relaxed`}
                />
                {fileNote ? (
                  <p className="text-meta text-ink-2" role="status">
                    {fileNote}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2 self-end">
                  <input
                    ref={fileRef}
                    id="catalog_file"
                    type="file"
                    accept={FILE_ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      void readFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className={settingsActionClass} onClick={() => fileRef.current?.click()}>
                    Choose a file
                  </button>
                  <button
                    type="submit"
                    disabled={previewPending}
                    className={settingsActionClass}
                  >
                    {previewPending ? "Scanning…" : "Scan"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-body text-ink-2">
            {previewState.message || "Tick products to keep."}
          </p>
          <SettingsGroup title="Products">
            {products.map((p, i) => {
              const warnings = productImportWarnings(p);
              return (
              <SettingsRow
                key={`p-${i}`}
                label={
                  warnings.length ? (
                    <>
                      {p.name}
                      <span className="ms-2 inline-block rounded-md bg-attention-tonal px-1.5 text-meta font-medium text-attention">
                        {warnings.join(" · ")}
                      </span>
                    </>
                  ) : (
                    p.name
                  )
                }
                hint={[catalogImportPriceLabel(p), p.category, p.in_stock ? `stock ${p.in_stock}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
                control="switch"
              >
                <ToolSwitch
                  checked={selected.has(i)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    setSelected(next);
                  }}
                  label={`Keep ${p.name}`}
                />
              </SettingsRow>
              );
            })}
          </SettingsGroup>

          {social && socialHandlesHaveContent(social) ? (
            <SettingsGroup title="Contacts">
              <SettingsRow
                label="Also save phones / social found"
                hint={social.channels
                  .filter((c) => c.value.trim())
                  .map((c) => `${c.kind}${c.label ? ` (${c.label})` : ""}: ${c.value}`)
                  .join(" · ")}
                control="switch"
              >
                <ToolSwitch
                  checked={includeSocial}
                  onChange={setIncludeSocial}
                  label="Also save phones / social found"
                />
              </SettingsRow>
            </SettingsGroup>
          ) : null}

          <SettingsSegmented
            label="Catalogue merge"
            value={mergeMode}
            options={
              [
                { id: "merge" as const, label: "Keep existing" },
                { id: "update" as const, label: "Update prices" },
                { id: "replace" as const, label: "Replace" },
              ] as const
            }
            onChange={setMergeMode}
          />
          <p className="-mt-2 text-meta text-ink-2">{MERGE_HINT[mergeMode]}</p>

          <form action={applyAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input
              type="hidden"
              name="products_json"
              value={JSON.stringify(selectedProducts)}
            />
            <input
              type="hidden"
              name="social_json"
              value={JSON.stringify(social || {})}
            />
            <input type="hidden" name="merge_mode" value={mergeMode} />
            <input
              type="hidden"
              name="include_social"
              value={includeSocial ? "1" : "0"}
            />
            <p className="w-full text-body text-ink">
              {selectedProducts.length} of {products.length} selected. Nothing is added until you confirm.
            </p>
            <button
              type="submit"
              name="confirm"
              value="1"
              disabled={applyPending || selectedProducts.length === 0}
              className={settingsPrimaryButtonClass}
            >
              {applyPending
                ? "Saving…"
                : selected.size === products.length
                  ? "Confirm all"
                  : "Confirm selected"}
            </button>
            <button
              type="submit"
              name="confirm"
              value="0"
              disabled={applyPending || selectedProducts.length === 0}
              className={settingsActionClass}
            >
              {applyPending ? "Saving…" : "Add to catalogue"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDismissed(previewState);
                setProducts(null);
              }}
              className={settingsActionClass}
            >
              Start over
            </button>
          </form>
        </div>
      )}

      {flash ? (
        <p
          className={
            flashIsError ? "text-body text-warn" : "text-body text-accent-deep"
          }
          role={flashIsError ? "alert" : "status"}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}

export const CatalogImportPanel = withRoleGate("settings.edit", CatalogImportPanelInner);

"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import type { ProductItem } from "@/lib/productCatalog";
import type { SocialHandles } from "@/lib/socialHandles";
import { socialHandlesHaveContent } from "@/lib/socialHandles";
import {
  applyCatalogImportAction,
  previewCatalogImportAction,
  type CatalogImportState,
} from "@/app/(desk)/settings/catalogActions";
import {
  settingsFieldClass,
  settingsRadioCardClass,
  compactTextareaExpandHandlers,
} from "@/components/settingsUi";

const fieldClass = settingsFieldClass;

const initial: CatalogImportState = {};

type Mode = "paste" | "csv" | "url";

export function CatalogImportPanel({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("csv");
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [products, setProducts] = useState<ProductItem[] | null>(null);
  const [social, setSocial] = useState<SocialHandles | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mergeMode, setMergeMode] = useState<"merge" | "replace">("merge");
  const [includeSocial, setIncludeSocial] = useState(false);

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
      setProducts(null);
      setPaste("");
      setUrl("");
      router.refresh();
      window.setTimeout(() => {
        document.getElementById("train")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 250);
    }
  }, [applyState, router]);

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
    (!products ? previewState.error || previewState.message : previewState.error);
  const flashIsError = Boolean(applyState.error || previewState.error);

  return (
    <section className="mt-8 space-y-4 border-t border-[var(--line)] pt-8">
      <div>
        <h3 className="text-sm font-medium text-[var(--ink)]">
          Import product catalogue
        </h3>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          Products (books, SKUs) separate from services. CSV works best; paste or a
          public product page also work.
        </p>
      </div>

      {!products ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { id: "csv" as const, label: "CSV / spreadsheet", blurb: "name,price,category,in_stock" },
                { id: "paste" as const, label: "Paste list", blurb: "One product per line" },
                { id: "url" as const, label: "Website", blurb: "Public catalogue page" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className={settingsRadioCardClass(mode === opt.id)}
              >
                <span className="font-medium text-[var(--ink)]">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                  {opt.blurb}
                </span>
              </button>
            ))}
          </div>

          <form action={previewAction} className="space-y-3">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="source_mode" value={mode} />
            {mode === "url" ? (
              <div className="flex flex-col gap-1.5">
                <label className="block text-sm font-medium" htmlFor="catalog_url">
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
                    className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {previewPending ? "Scanning…" : "Scan catalogue"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="block text-sm font-medium" htmlFor="catalog_paste">
                  {mode === "csv" ? "Paste CSV rows" : "Paste product list"}
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
                      ? "name,price,category,in_stock,sku\nAtomic Habits,2500 KES,Self-help,yes,\nRich Dad Poor Dad,1800 KES,Finance,yes,"
                      : "Atomic Habits - 2,500 KES\nRich Dad Poor Dad - 1,800 KES"
                  }
                  className={`${fieldClass} mt-0 text-sm leading-relaxed`}
                />
                <div className="flex justify-end self-end">
                  <button
                    type="submit"
                    disabled={previewPending}
                    className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {previewPending ? "Scanning…" : "Scan catalogue"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--ink-soft)]">
            {previewState.message || "Tick products to keep."}
          </p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {products.map((p, i) => (
              <li
                key={`p-${i}`}
                className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(i)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    setSelected(next);
                  }}
                />
                <div>
                  <p className="font-medium text-[var(--ink)]">{p.name}</p>
                  <p className="text-[var(--ink-soft)]">
                    {[p.price, p.category, p.in_stock ? `stock ${p.in_stock}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {social && socialHandlesHaveContent(social) ? (
            <label className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeSocial}
                onChange={(e) => setIncludeSocial(e.target.checked)}
              />
              <span>
                <span className="font-medium">Also save phones / social found</span>
                <span className="mt-1 block text-[var(--ink-soft)]">
                  {social.channels
                    .filter((c) => c.value.trim())
                    .map((c) => `${c.kind}${c.label ? ` (${c.label})` : ""}: ${c.value}`)
                    .join(" · ")}
                </span>
              </span>
            </label>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMergeMode("merge")}
              className={[
                "rounded-xl border px-3 py-2 text-left text-sm",
                mergeMode === "merge"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] bg-white",
              ].join(" ")}
            >
              Keep existing products
            </button>
            <button
              type="button"
              onClick={() => setMergeMode("replace")}
              className={[
                "rounded-xl border px-3 py-2 text-left text-sm",
                mergeMode === "replace"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] bg-white",
              ].join(" ")}
            >
              Replace catalogue
            </button>
          </div>

          <form action={applyAction} className="flex flex-wrap gap-2">
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
            <button
              type="submit"
              disabled={applyPending || selectedProducts.length === 0}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {applyPending ? "Saving…" : "Add to catalogue"}
            </button>
            <button
              type="button"
              onClick={() => setProducts(null)}
              className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
            >
              Start over
            </button>
          </form>
        </div>
      )}

      {flash ? (
        <p
          className={
            flashIsError ? "text-sm text-[var(--warn)]" : "text-sm text-[var(--accent-deep)]"
          }
          role={flashIsError ? "alert" : "status"}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}

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
    <section className="mt-8 space-y-4 border-t border-line pt-8">
      <p className={settingsBlockTitleClass}>Products</p>

      {!products ? (
        <div className="space-y-3">
          <SettingsSegmented
            label="Catalogue source"
            value={mode}
            options={
              [
                { id: "csv" as const, label: "CSV" },
                { id: "paste" as const, label: "Paste" },
                { id: "url" as const, label: "Website" },
              ] as const
            }
            onChange={setMode}
          />

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
                    className={settingsActionClass}
                  >
                    {previewPending ? "Scanning…" : "Scan"}
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
          <p className="text-sm text-ink-soft">
            {previewState.message || "Tick products to keep."}
          </p>
          <SettingsGroup title="Products">
            {products.map((p, i) => (
              <SettingsRow
                key={`p-${i}`}
                label={p.name}
                hint={[p.price, p.category, p.in_stock ? `stock ${p.in_stock}` : ""]
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
            ))}
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
                { id: "replace" as const, label: "Replace" },
              ] as const
            }
            onChange={setMergeMode}
          />

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
              className={settingsPrimaryButtonClass}
            >
              {applyPending ? "Saving…" : "Add to catalogue"}
            </button>
            <button
              type="button"
              onClick={() => setProducts(null)}
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
            flashIsError ? "text-sm text-warn" : "text-sm text-accent-deep"
          }
          role={flashIsError ? "alert" : "status"}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}

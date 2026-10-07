"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { DeskSelect } from "@/components/ui/DeskSelect";
import {
  previewSuggestedProducts,
  suggestImportedProducts,
} from "@/lib/catalogSuggest";
import {
  emptyProduct,
  parseBulkProducts,
  PRODUCT_CATALOG_MAX,
  type ProductItem,
} from "@/lib/productCatalog";
import { CatalogImportSheet } from "@/components/settings/catalog/CatalogImportSheet";
import { CatalogPager } from "@/components/settings/catalog/CatalogPager";
import { catalogRowStamp } from "@/components/settings/catalog/catalogStamp";
import {
  CATALOG_PRODUCT_PAGE_SIZE,
  CATALOG_STOCK_OPTIONS,
} from "@/components/settings/catalog/catalogConstants";
import {
  settingsBlockTitleClass,
  settingsDenseFieldClass,
  settingsGhostButtonClass,
  settingsTableFieldClass,
  settingsTrashButtonClass,
  TrashIcon,
} from "@/components/settingsUi";

export function ProductCatalogEditor({
  products,
  setProducts,
  updateProduct,
  requestRemove,
}: {
  products: ProductItem[];
  setProducts: Dispatch<SetStateAction<ProductItem[]>>;
  updateProduct: (index: number, key: keyof ProductItem, value: string) => void;
  requestRemove: (row: object, title: string, body: string, run: () => void) => void;
}) {
  const [productPage, setProductPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(products.length / CATALOG_PRODUCT_PAGE_SIZE));
  const safePage = Math.min(productPage, pageCount - 1);
  const visible = products.slice(
    safePage * CATALOG_PRODUCT_PAGE_SIZE,
    safePage * CATALOG_PRODUCT_PAGE_SIZE + CATALOG_PRODUCT_PAGE_SIZE
  );

  const bulkPreview = useMemo(
    () => previewSuggestedProducts(parseBulkProducts(bulkText)),
    [bulkText]
  );

  function applyBulk() {
    const parsed = suggestImportedProducts(parseBulkProducts(bulkText));
    if (!parsed.length) {
      setBulkError("Add at least one product. Example: Atomic Habits - 2,500 KES");
      return;
    }
    setProducts((prev) => {
      const existing = prev.filter((p) => p.name.trim());
      const map = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
      for (const p of parsed) {
        if (!map.has(p.name.toLowerCase())) map.set(p.name.toLowerCase(), p);
      }
      return [...map.values()].slice(0, PRODUCT_CATALOG_MAX);
    });
    setBulkText("");
    setBulkError(null);
  }

  const denseFieldClass = settingsDenseFieldClass;
  const tableFieldClass = settingsTableFieldClass;
  const stockOptions = [...CATALOG_STOCK_OPTIONS];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className={settingsBlockTitleClass}>Products</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setImportOpen(true)} className={settingsGhostButtonClass}>
            Paste or import
          </button>
          <button
            type="button"
            onClick={() => {
              setProducts((prev) => [...prev, emptyProduct()]);
              setProductPage(Math.floor(products.length / CATALOG_PRODUCT_PAGE_SIZE));
            }}
            className={settingsGhostButtonClass}
          >
            Add product
          </button>
        </div>
      </div>

      <CatalogImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Paste products"
        description="CSV or one name per line. We tidy titles before you add."
        placeholder={
          "name,price,category,in_stock\nAtomic Habits,2500 KES,Self-help,yes\n\nOr:\nAtomic Habits - 2,500 KES"
        }
        text={bulkText}
        onTextChange={(value) => {
          setBulkText(value);
          if (bulkError) setBulkError(null);
        }}
        previewRows={bulkPreview}
        onApply={applyBulk}
        applyLabel="Add to catalogue"
      />
      {bulkError ? (
        <p className="text-sm text-warn" role="alert">
          {bulkError}
        </p>
      ) : null}

      {products.length === 0 ? (
        <p className="text-meta text-ink-2">No products yet. Paste a list or add one row.</p>
      ) : (
        <>
          <div className="lg:hidden">
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline">
            {visible.map((product, localIndex) => {
              const index = safePage * CATALOG_PRODUCT_PAGE_SIZE + localIndex;
              const preview = [product.price, product.category].filter(Boolean).join(" · ");
              return (
                <li key={`product-m-${index}`} className="bg-surface">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-ink">
                        {product.name.trim() || `Product ${index + 1}`}
                      </p>
                      {preview ? (
                        <p className="mt-0.5 truncate text-meta text-ink-2">{preview}</p>
                      ) : null}
                      <div className="mt-1">{catalogRowStamp(product)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        requestRemove(
                          product,
                          `Remove ${product.name.trim() || "this product"}?`,
                          "It leaves the catalog when you save.",
                          () => setProducts((prev) => prev.filter((_, i) => i !== index))
                        )
                      }
                      className={settingsTrashButtonClass}
                      aria-label={`Remove product ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 border-t border-hairline px-4 py-3">
                    <input
                      value={product.name}
                      onChange={(e) => updateProduct(index, "name", e.target.value)}
                      placeholder="Atomic Habits"
                      className={denseFieldClass}
                      aria-label="Product name"
                    />
                    <input
                      value={product.price}
                      onChange={(e) => updateProduct(index, "price", e.target.value)}
                      placeholder="2,500 KES"
                      className={denseFieldClass}
                      aria-label="Price"
                    />
                    <DeskSelect
                      aria-label="Stock"
                      value={
                        product.in_stock === "yes" ||
                        product.in_stock === "no" ||
                        product.in_stock === "unknown"
                          ? product.in_stock
                          : ""
                      }
                      placeholder="Not set"
                      className={denseFieldClass}
                      options={stockOptions}
                      onChange={(next) => updateProduct(index, "in_stock", next)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <CatalogPager
            page={safePage}
            pageSize={CATALOG_PRODUCT_PAGE_SIZE}
            total={products.length}
            noun="product"
            onPage={setProductPage}
          />
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-line lg:block">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                    <th className="min-w-0 px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Category</th>
                    <th className="px-3 py-2.5 font-medium">Stock</th>
                    <th className="px-3 py-2.5 font-medium w-12">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface">
                  {visible.map((product, localIndex) => {
                    const index = safePage * CATALOG_PRODUCT_PAGE_SIZE + localIndex;
                    return (
                      <tr key={`product-${index}`} className="align-middle">
                        <td className="min-w-0 px-3 py-2">
                          <div className="mb-1">{catalogRowStamp(product)}</div>
                          <input
                            value={product.name}
                            title={product.name || undefined}
                            onChange={(e) => updateProduct(index, "name", e.target.value)}
                            placeholder="Atomic Habits"
                            className={tableFieldClass}
                            aria-label="Product name"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={product.price}
                            onChange={(e) => updateProduct(index, "price", e.target.value)}
                            placeholder="2,500 KES"
                            className={tableFieldClass}
                            aria-label="Price"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={product.category}
                            onChange={(e) => updateProduct(index, "category", e.target.value)}
                            placeholder="Self-help"
                            className={tableFieldClass}
                            aria-label="Category"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <DeskSelect
                            aria-label="Stock status"
                            value={
                              product.in_stock === "yes" ||
                              product.in_stock === "no" ||
                              product.in_stock === "unknown"
                                ? product.in_stock
                                : ""
                            }
                            placeholder="Not set"
                            className={tableFieldClass}
                            options={stockOptions}
                            onChange={(next) => updateProduct(index, "in_stock", next)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              requestRemove(
                                product,
                                `Remove ${product.name.trim() || "this product"}?`,
                                "It leaves the catalog when you save.",
                                () => setProducts((prev) => prev.filter((_, i) => i !== index))
                              )
                            }
                            className={settingsTrashButtonClass}
                            aria-label={`Remove product ${index + 1}`}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <CatalogPager
              page={safePage}
              pageSize={CATALOG_PRODUCT_PAGE_SIZE}
              total={products.length}
              noun="product"
              onPage={setProductPage}
            />
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { Button, buttonClass } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  HOME_SUGGESTED_SERVICES,
  SHOP_SUGGESTED_PRODUCTS,
} from "@/lib/catalogSeeds";
import { suggestImportedProducts, suggestImportedServices } from "@/lib/catalogSuggest";
import { parseProductCsv, type ProductItem } from "@/lib/productCatalog";
import { parseBulkServices } from "@/lib/servicesCatalog";
import type { BusinessVertical } from "@/lib/vertical";

export type ProductDraft = {
  name: string;
  category: string;
  price: string;
  notes: string;
};

export type ServiceDraft = {
  name: string;
  pricing_mode: "" | "fixed" | "from" | "range" | "ask";
  site_visit: "yes" | "no" | "";
  notes: string;
};

const PRICE_MODES = [
  { id: "fixed", label: "Fixed" },
  { id: "from", label: "From" },
  { id: "range", label: "Range" },
  { id: "ask", label: "Ask" },
] as const;

function chipClass(on: boolean): string {
  return buttonClass({
    variant: on ? "tonal" : "ghost",
    size: "sm",
    className: on ? "!rounded-md" : "!rounded-md text-ink-3",
  });
}

export function OnboardingCapture({
  vertical,
  products,
  services,
  onProducts,
  onServices,
}: {
  vertical: BusinessVertical | "";
  products: ProductDraft[];
  services: ServiceDraft[];
  onProducts: (rows: ProductDraft[]) => void;
  onServices: (rows: ServiceDraft[]) => void;
}) {
  const shop = vertical !== "home_services";
  const suggestions = shop ? SHOP_SUGGESTED_PRODUCTS : HOME_SUGGESTED_SERVICES;

  function addProduct(name = "") {
    onProducts([...products, { name, category: "", price: "", notes: "" }]);
  }

  function addService(name = "") {
    onServices([
      ...services,
      { name, pricing_mode: "", site_visit: "", notes: "" },
    ]);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    if (shop) {
      const parsed = suggestImportedProducts(parseProductCsv(text));
      if (!parsed.length) return;
      onProducts([
        ...products,
        ...parsed.map((row: ProductItem) => ({
          name: row.name,
          category: row.category,
          price: row.price,
          notes: row.notes,
        })),
      ]);
      return;
    }
    const parsed = suggestImportedServices(parseBulkServices(text));
    if (!parsed.length) return;
    onServices([
      ...services,
      ...parsed.map((row) => ({
        name: row.name,
        pricing_mode: (row.pricing_mode || "") as ServiceDraft["pricing_mode"],
        site_visit: "" as const,
        notes: row.notes,
      })),
    ]);
  }

  const empty = shop ? products.length === 0 : services.length === 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap gap-2">
        {suggestions.map((name) => {
          const on = shop
            ? products.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())
            : services.some((row) => row.name.trim().toLowerCase() === name.toLowerCase());
          return (
            <button
              key={name}
              type="button"
              className={chipClass(on)}
              onClick={() => {
                if (on) return;
                if (shop) addProduct(name);
                else addService(name);
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      {empty ? (
        <Empty
          title={shop ? "No products yet" : "No services yet"}
          line="Add a row, tap a suggestion, or upload a list."
          className="!py-6"
        />
      ) : null}

      {shop
        ? products.map((row, index) => (
            <div key={`product-${index}`} className="grid gap-3 sm:grid-cols-2">
              <Field id={`product-name-${index}`} label="Product">
                {(props) => (
                  <Input
                    {...props}
                    value={row.name}
                    onChange={(event) => {
                      const next = products.slice();
                      next[index] = { ...row, name: event.target.value };
                      onProducts(next);
                    }}
                  />
                )}
              </Field>
              <Field id={`product-price-${index}`} label="Price">
                {(props) => (
                  <Input
                    {...props}
                    value={row.price}
                    onChange={(event) => {
                      const next = products.slice();
                      next[index] = { ...row, price: event.target.value };
                      onProducts(next);
                    }}
                  />
                )}
              </Field>
              <Field id={`product-category-${index}`} label="Category">
                {(props) => (
                  <Input
                    {...props}
                    value={row.category}
                    onChange={(event) => {
                      const next = products.slice();
                      next[index] = { ...row, category: event.target.value };
                      onProducts(next);
                    }}
                  />
                )}
              </Field>
              <Field id={`product-notes-${index}`} label="Note" hint="Optional">
                {(props) => (
                  <Input
                    {...props}
                    value={row.notes}
                    maxLength={80}
                    onChange={(event) => {
                      const next = products.slice();
                      next[index] = { ...row, notes: event.target.value };
                      onProducts(next);
                    }}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onProducts(products.filter((_, item) => item !== index))}
              >
                Remove
              </Button>
            </div>
          ))
        : services.map((row, index) => (
            <div key={`service-${index}`} className="grid gap-3 sm:grid-cols-2">
              <Field id={`service-name-${index}`} label="Service">
                {(props) => (
                  <Input
                    {...props}
                    value={row.name}
                    onChange={(event) => {
                      const next = services.slice();
                      next[index] = { ...row, name: event.target.value };
                      onServices(next);
                    }}
                  />
                )}
              </Field>
              <Field id={`service-mode-${index}`} label="Price mode">
                {(props) => (
                  <Select
                    {...props}
                    value={row.pricing_mode}
                    onChange={(event) => {
                      const next = services.slice();
                      next[index] = {
                        ...row,
                        pricing_mode: event.target.value as ServiceDraft["pricing_mode"],
                      };
                      onServices(next);
                    }}
                  >
                    <option value="">Choose</option>
                    {PRICE_MODES.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id={`service-visit-${index}`} label="Site visit">
                {(props) => (
                  <Select
                    {...props}
                    value={row.site_visit}
                    onChange={(event) => {
                      const next = services.slice();
                      next[index] = {
                        ...row,
                        site_visit: event.target.value as ServiceDraft["site_visit"],
                      };
                      onServices(next);
                    }}
                  >
                    <option value="">Choose</option>
                    <option value="yes">Required</option>
                    <option value="no">Not required</option>
                  </Select>
                )}
              </Field>
              <Field id={`service-notes-${index}`} label="Note" hint="Optional">
                {(props) => (
                  <Input
                    {...props}
                    value={row.notes}
                    maxLength={80}
                    onChange={(event) => {
                      const next = services.slice();
                      next[index] = { ...row, notes: event.target.value };
                      onServices(next);
                    }}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onServices(services.filter((_, item) => item !== index))}
              >
                Remove
              </Button>
            </div>
          ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="tonal"
          size="sm"
          onClick={() => (shop ? addProduct() : addService())}
        >
          {shop ? "Add product" : "Add service"}
        </Button>
        <label className={buttonClass({ variant: "ghost", size: "sm" })}>
          Upload list
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

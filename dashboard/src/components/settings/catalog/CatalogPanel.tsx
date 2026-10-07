"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { SettingsSegmented } from "@/components/settingsUi";
import { CatalogSectionShell } from "@/components/settings/catalog/CatalogSectionShell";
import { ProductCatalogEditor } from "@/components/settings/catalog/ProductCatalogEditor";
import { ServiceCatalogEditor } from "@/components/settings/catalog/ServiceCatalogEditor";
import type { ProductItem } from "@/lib/productCatalog";
import type { ServiceItem } from "@/lib/servicesCatalog";
import type { BusinessVertical } from "@/lib/vertical";

type RetailCatalogTab = "products" | "services";

export function CatalogPanel({
  active,
  vertical,
  services,
  products,
  setServices,
  setProducts,
  servicesNotes,
  onServicesNotesChange,
  updateService,
  updateProduct,
  requestRemove,
  servicesPasteExample,
}: {
  active: boolean;
  vertical: BusinessVertical;
  services: ServiceItem[];
  products: ProductItem[];
  setServices: Dispatch<SetStateAction<ServiceItem[]>>;
  setProducts: Dispatch<SetStateAction<ProductItem[]>>;
  servicesNotes: string;
  onServicesNotesChange: (value: string) => void;
  updateService: (index: number, key: keyof ServiceItem, value: string) => void;
  updateProduct: (index: number, key: keyof ProductItem, value: string) => void;
  requestRemove: (row: object, title: string, body: string, run: () => void) => void;
  servicesPasteExample: string;
}) {
  const hasProducts = useMemo(
    () => products.some((p) => p.name.trim()),
    [products]
  );
  const [retailTab, setRetailTab] = useState<RetailCatalogTab>(() =>
    hasProducts ? "products" : "services"
  );

  if (!active) return null;

  const homeOnly = vertical === "home_services";

  return (
    <section className="space-y-4">
      <CatalogSectionShell vertical={vertical} title="Catalogue">
        {homeOnly ? (
          <ServiceCatalogEditor
            vertical={vertical}
            services={services}
            setServices={setServices}
            servicesNotes={servicesNotes}
            onServicesNotesChange={onServicesNotesChange}
            updateService={updateService}
            requestRemove={requestRemove}
            servicesPasteExample={servicesPasteExample}
          />
        ) : (
          <>
            <SettingsSegmented
              label="Catalogue type"
              value={retailTab}
              options={[
                { id: "products", label: "Products" },
                { id: "services", label: "Services" },
              ]}
              onChange={setRetailTab}
            />
            {retailTab === "products" ? (
              <ProductCatalogEditor
                products={products}
                setProducts={setProducts}
                updateProduct={updateProduct}
                requestRemove={requestRemove}
              />
            ) : (
              <ServiceCatalogEditor
                vertical={vertical}
                services={services}
                setServices={setServices}
                servicesNotes={servicesNotes}
                onServicesNotesChange={onServicesNotesChange}
                updateService={updateService}
                requestRemove={requestRemove}
                servicesPasteExample={servicesPasteExample}
              />
            )}
          </>
        )}
      </CatalogSectionShell>
    </section>
  );
}

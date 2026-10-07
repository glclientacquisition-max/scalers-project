"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  previewSuggestedServices,
  suggestImportedServices,
} from "@/lib/catalogSuggest";
import {
  emptyService,
  parseBulkServices,
  type ServiceItem,
} from "@/lib/servicesCatalog";
import type { BusinessVertical } from "@/lib/vertical";
import { CatalogImportSheet } from "@/components/settings/catalog/CatalogImportSheet";
import { CatalogPager } from "@/components/settings/catalog/CatalogPager";
import { catalogRowStamp } from "@/components/settings/catalog/catalogStamp";
import { CATALOG_SERVICE_PAGE_SIZE } from "@/components/settings/catalog/catalogConstants";
import {
  settingsBlockTitleClass,
  settingsDenseFieldClass,
  settingsGhostButtonClass,
  settingsTableFieldClass,
  settingsTrashButtonClass,
  TrashIcon,
} from "@/components/settingsUi";

export function ServiceCatalogEditor({
  vertical,
  services,
  setServices,
  servicesNotes,
  onServicesNotesChange,
  updateService,
  requestRemove,
  servicesPasteExample,
}: {
  vertical: BusinessVertical;
  services: ServiceItem[];
  setServices: Dispatch<SetStateAction<ServiceItem[]>>;
  servicesNotes: string;
  onServicesNotesChange: (value: string) => void;
  updateService: (index: number, key: keyof ServiceItem, value: string) => void;
  requestRemove: (row: object, title: string, body: string, run: () => void) => void;
  servicesPasteExample: string;
}) {
  const [servicePage, setServicePage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(services.length / CATALOG_SERVICE_PAGE_SIZE));
  const safePage = Math.min(servicePage, pageCount - 1);
  const visible = services.slice(
    safePage * CATALOG_SERVICE_PAGE_SIZE,
    safePage * CATALOG_SERVICE_PAGE_SIZE + CATALOG_SERVICE_PAGE_SIZE
  );

  const bulkPreview = useMemo(
    () => previewSuggestedServices(parseBulkServices(bulkText), vertical),
    [bulkText, vertical]
  );

  function applyBulk() {
    const parsed = suggestImportedServices(parseBulkServices(bulkText), vertical);
    if (!parsed.length) {
      setBulkError("Add at least one service name. Example: Home cleaning");
      return;
    }
    setServices((prev) => {
      const existing = prev.filter((s) => s.name.trim());
      return [...existing, ...parsed].slice(0, 40);
    });
    setBulkText("");
    setBulkError(null);
  }

  const denseFieldClass = settingsDenseFieldClass;
  const tableFieldClass = settingsTableFieldClass;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className={settingsBlockTitleClass}>Services</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setImportOpen(true)} className={settingsGhostButtonClass}>
            Paste or import
          </button>
          <button
            type="button"
            onClick={() => {
              setServices((prev) => [...prev, emptyService()]);
              setServicePage(Math.floor(services.length / CATALOG_SERVICE_PAGE_SIZE));
            }}
            className={settingsGhostButtonClass}
          >
            Add service
          </button>
        </div>
      </div>

      <CatalogImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Paste services"
        description="One line per service. We tidy names before you add."
        placeholder={servicesPasteExample}
        text={bulkText}
        onTextChange={(value) => {
          setBulkText(value);
          if (bulkError) setBulkError(null);
        }}
        previewRows={bulkPreview}
        onApply={applyBulk}
        applyLabel="Add to services"
      />
      {bulkError ? (
        <p className="text-sm text-warn" role="alert">
          {bulkError}
        </p>
      ) : null}

      {services.filter((s) => s.name.trim()).length === 0 ? (
        <p className="text-meta text-ink-2">No services yet. Paste a list or add one row.</p>
      ) : (
        <>
          <div className="lg:hidden">
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline">
            {visible.map((service, localIndex) => {
              const index = safePage * CATALOG_SERVICE_PAGE_SIZE + localIndex;
              const preview = [service.price_range, service.notes].filter(Boolean).join(" · ");
              return (
                <li key={`service-m-${index}`} className="bg-surface">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-ink">
                        {service.name.trim() || `Service ${index + 1}`}
                      </p>
                      {preview ? (
                        <p className="mt-0.5 truncate text-meta text-ink-2">{preview}</p>
                      ) : null}
                      <div className="mt-1">{catalogRowStamp(service)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        requestRemove(
                          service,
                          `Remove ${service.name.trim() || "this service"}?`,
                          "It leaves the catalog when you save.",
                          () =>
                            setServices((prev) =>
                              prev.length <= 1
                                ? [emptyService()]
                                : prev.filter((_, i) => i !== index)
                            )
                        )
                      }
                      className={settingsTrashButtonClass}
                      aria-label={`Remove service ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 border-t border-hairline px-4 py-3">
                    <input
                      id={`svc-name-m-${index}`}
                      value={service.name}
                      onChange={(e) => updateService(index, "name", e.target.value)}
                      placeholder={vertical === "retail" ? "Book sourcing" : "Home cleaning"}
                      className={denseFieldClass}
                      aria-label="Service name"
                    />
                    <input
                      id={`svc-price-m-${index}`}
                      value={service.price_range}
                      onChange={(e) => updateService(index, "price_range", e.target.value)}
                      placeholder="from 2,500 KES"
                      className={denseFieldClass}
                      aria-label="Price"
                    />
                    <input
                      id={`svc-notes-m-${index}`}
                      value={service.notes}
                      onChange={(e) => updateService(index, "notes", e.target.value)}
                      placeholder="Free quotation"
                      className={denseFieldClass}
                      aria-label="Notes"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <CatalogPager
            page={safePage}
            pageSize={CATALOG_SERVICE_PAGE_SIZE}
            total={services.length}
            noun="service"
            onPage={setServicePage}
          />
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-line lg:block">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                    <th className="min-w-0 px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Notes</th>
                    <th className="px-3 py-2.5 font-medium">Out of scope</th>
                    <th className="px-3 py-2.5 font-medium w-16">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface">
                  {visible.map((service, localIndex) => {
                    const index = safePage * CATALOG_SERVICE_PAGE_SIZE + localIndex;
                    return (
                      <tr key={`service-${index}`} className="align-middle">
                        <td className="min-w-0 px-3 py-2">
                          <div className="mb-1">{catalogRowStamp(service)}</div>
                          <input
                            id={`svc-name-${index}`}
                            value={service.name}
                            title={service.name || undefined}
                            onChange={(e) => updateService(index, "name", e.target.value)}
                            placeholder={
                              vertical === "retail" ? "Book sourcing / special orders" : "Home cleaning"
                            }
                            className={tableFieldClass}
                            aria-label="Service name"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            id={`svc-price-${index}`}
                            value={service.price_range}
                            onChange={(e) => updateService(index, "price_range", e.target.value)}
                            placeholder="from 2,500 KES"
                            className={tableFieldClass}
                            aria-label="Price range"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            id={`svc-notes-${index}`}
                            value={service.notes}
                            onChange={(e) => updateService(index, "notes", e.target.value)}
                            placeholder="Free quotation"
                            className={tableFieldClass}
                            aria-label="Notes"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            id={`svc-oos-${index}`}
                            value={service.out_of_scope}
                            onChange={(e) => updateService(index, "out_of_scope", e.target.value)}
                            placeholder="No commercial offices"
                            className={tableFieldClass}
                            aria-label="Out of scope"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              requestRemove(
                                service,
                                `Remove ${service.name.trim() || "this service"}?`,
                                "It leaves the catalog when you save.",
                                () =>
                                  setServices((prev) =>
                                    prev.length <= 1
                                      ? [emptyService()]
                                      : prev.filter((_, i) => i !== index)
                                  )
                              )
                            }
                            className={settingsTrashButtonClass}
                            aria-label={`Remove service ${index + 1}`}
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
              pageSize={CATALOG_SERVICE_PAGE_SIZE}
              total={services.length}
              noun="service"
              onPage={setServicePage}
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-xs font-medium text-ink-soft" htmlFor="services_notes">
          Notes
        </label>
        <textarea
          id="services_notes"
          value={servicesNotes}
          onChange={(e) => onServicesNotesChange(e.target.value)}
          rows={2}
          placeholder="Coverage, lead times, exclusions"
          className={`${denseFieldClass} mt-1 leading-relaxed`}
        />
      </div>
    </div>
  );
}

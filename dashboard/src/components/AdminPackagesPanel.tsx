"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { Switch } from "@/components/ui/Switch";
import {
  annualPriceKes,
  inboundKesPerMinute,
  kesPerSecondFromMinute,
  minutesUsedFromSeconds,
  outboundKesPerMinute,
  type BillingPackage,
  type BillingRateCard,
  type TenantSubscriptionRow,
} from "@/lib/packageCatalog";
import { packagePriceLabel } from "@/lib/packagePriceLabel";
import { usedOfIncluded } from "@/lib/packageUsageAlign";
import { requestErrorText } from "@/lib/adminBillingCopy";

type Tab = "packages" | "shops";
type SheetKind = "rates" | "sku";

/** Packages are assigned on the business's Billing page, behind one confirm. */
function billingHref(tenantId: string) {
  return `/admin/billing/${tenantId}`;
}

function SheetNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="pb-3 text-body text-attention" role="alert">
      {error}
    </p>
  );
}

function shopPreview(row: TenantSubscriptionRow) {
  if (row.gap) return row.gap;
  if (row.packageName) return "Matches package";
  return "No package";
}

function shopWhen(row: TenantSubscriptionRow) {
  const pack = row.packageName || "None";
  return row.period ? `${pack} / ${row.period}` : pack;
}

function skuPreview(pack: BillingPackage, yearKes: number) {
  return `${packagePriceLabel(pack.monthlyPriceKes)} · Per year ${packagePriceLabel(yearKes)}`;
}

export function AdminPackagesPanel({
  rates: initialRates,
  packages: initialPackages,
  businesses,
  catalogOnly = false,
}: {
  rates: BillingRateCard;
  packages: BillingPackage[];
  businesses: TenantSubscriptionRow[];
  catalogOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rates, setRates] = useState(initialRates);
  const [packs, setPacks] = useState(initialPackages);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("packages");
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [skuId, setSkuId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const inboundMin = inboundKesPerMinute(rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(rates.outboundKesPerSecond);

  const sku = packs.find((pack) => pack.id === skuId) || null;
  const skuIndex = packs.findIndex((pack) => pack.id === skuId);
  const needsYou = businesses.filter((row) => !row.packageName);

  const shopRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return businesses;
    return businesses.filter(
      (row) =>
        row.businessName.toLowerCase().includes(q) ||
        (row.packageName || "").toLowerCase().includes(q),
    );
  }, [businesses, query]);

  function patchPack(index: number, patch: Partial<BillingPackage>) {
    setPacks((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function openRates() {
    setError(null);
    setSheet("rates");
  }

  function openSku(id: string) {
    setError(null);
    setSkuId(id);
    setSheet("sku");
  }

  async function post(body: Record<string, unknown>, okText: string) {
    setError(null);
    setStatus(null);
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(requestErrorText(json, "Could not save. Nothing changed."));
      return false;
    }
    setStatus(okText);
    startTransition(() => router.refresh());
    return true;
  }

  return (
    <>
      {!catalogOnly && needsYou.length > 0 ? (
        <section>
          <p className="px-4 text-caption text-ink-3">Needs you</p>
          <ul className="divide-y divide-hairline">
            {needsYou.map((row) => (
              <ListRow
                key={row.tenantId}
                title={row.businessName}
                preview={row.gap || "No package. Open to assign one."}
                unread
                href={billingHref(row.tenantId)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="px-4 text-caption text-ink-3">Rates</p>
        <ul className="divide-y divide-hairline">
          <ListRow
            title="On-demand"
            preview={`Inbound KES ${inboundMin}/min · Year -${rates.annualDiscountPercent}%`}
            onOpen={openRates}
          />
        </ul>
      </section>

      <section>
        <p className="px-4 text-caption text-ink-3">{tab === "packages" ? "Packages" : "Shops"}</p>
        {catalogOnly ? null : (
          <Segmented
            label="Packages filter"
            items={[
              { key: "packages", label: "Packages", count: packs.length, active: tab === "packages" },
              { key: "shops", label: "Shops", count: businesses.length, active: tab === "shops" },
            ]}
            onSelect={(key) => setTab(key as Tab)}
          />
        )}
        {error && !sheet ? (
          <p className="px-4 text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        {status && !sheet ? (
          <p className="px-4 text-body text-ok" role="status">
            {status}
          </p>
        ) : null}

        {tab === "packages" || catalogOnly ? (
          packs.length === 0 ? (
            <Empty title="No packages." line="Add a SKU in the catalog." />
          ) : (
            <ul className="divide-y divide-hairline">
              {packs.map((pack) => (
                <ListRow
                  key={pack.id}
                  title={pack.name}
                  preview={skuPreview(pack, annualPriceKes(pack.monthlyPriceKes, rates.annualDiscountPercent))}
                  when={`${pack.minutes.toLocaleString("en-KE")} min`}
                  stamp={<Stamp tone={pack.isActive ? "live" : "neutral"}>{pack.isActive ? "Live" : "Hidden"}</Stamp>}
                  onOpen={() => openSku(pack.id)}
                />
              ))}
            </ul>
          )
        ) : (
          <>
            <div className="px-4 py-2">
              <Input
                id="pack-shop-search"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Search"
                aria-label="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {shopRows.length === 0 ? (
              <Empty
                title={businesses.length === 0 ? "No businesses." : "No match."}
                line={businesses.length === 0 ? "A business shows up here after signup." : "Try another name."}
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {shopRows.map((row) => (
                  <ListRow
                    key={row.tenantId}
                    title={row.businessName}
                    preview={shopPreview(row)}
                    when={shopWhen(row)}
                    stamp={
                      <Stamp tone={row.packageName && !row.gap ? "ok" : "attention"}>
                        {usedOfIncluded(minutesUsedFromSeconds(row.usage.secondsUsed), row.usage.minutesIncluded)}
                      </Stamp>
                    }
                    href={billingHref(row.tenantId)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <Sheet
        open={sheet === "rates"}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title="On-demand rates"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={pending}
            onClick={() =>
              void post(
                {
                  action: "save_rates",
                  inbound_kes_per_second: rates.inboundKesPerSecond,
                  outbound_kes_per_second: rates.outboundKesPerSecond,
                  whatsapp_kes: rates.whatsappKes,
                  sms_kes: rates.smsKes,
                  email_kes: rates.emailKes,
                  annual_discount_percent: rates.annualDiscountPercent,
                },
                "Rates saved.",
              ).then((ok) => {
                if (ok) setSheet(null);
              })
            }
          >
            Save rates
          </Button>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <Field id="rate-in" label="Inbound KES / min" hint={`KES ${rates.inboundKesPerSecond}/sec`}>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={inboundMin}
                onChange={(e) =>
                  setRates({
                    ...rates,
                    inboundKesPerSecond: kesPerSecondFromMinute(Number(e.target.value)),
                  })
                }
              />
            )}
          </Field>
          <Field
            id="rate-out"
            label="Outbound KES / min"
            hint={`KES ${rates.outboundKesPerSecond}/sec. Hidden until live transfer.`}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={outboundMin}
                onChange={(e) =>
                  setRates({
                    ...rates,
                    outboundKesPerSecond: kesPerSecondFromMinute(Number(e.target.value)),
                  })
                }
              />
            )}
          </Field>
          <Field id="rate-wa" label="WhatsApp KES">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={rates.whatsappKes}
                onChange={(e) => setRates({ ...rates, whatsappKes: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field id="rate-sms" label="SMS KES / segment">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={rates.smsKes}
                onChange={(e) => setRates({ ...rates, smsKes: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field id="rate-email" label="Email KES">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={rates.emailKes}
                onChange={(e) => setRates({ ...rates, emailKes: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field id="rate-year" label="Annual discount %">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={rates.annualDiscountPercent}
                onChange={(e) => setRates({ ...rates, annualDiscountPercent: Number(e.target.value) })}
              />
            )}
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={sheet === "sku"}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title={sku?.name || "Package"}
        theme="admin"
        footer={
          sku ? (
            <Button
              type="button"
              block
              pending={pending}
              onClick={() =>
                void post(
                  {
                    action: "save_package",
                    id: sku.id,
                    sku: sku.sku,
                    name: sku.name,
                    monthly_price_kes: sku.monthlyPriceKes,
                    seats: sku.seats,
                    minutes: sku.minutes,
                    sms: sku.sms,
                    email: sku.email,
                    staff_wa: sku.staffWa,
                    dids: sku.dids,
                    sort_order: sku.sortOrder,
                    is_active: sku.isActive,
                  },
                  `${sku.name} saved.`,
                ).then((ok) => {
                  if (ok) setSheet(null);
                })
              }
            >
              Save
            </Button>
          ) : null
        }
      >
        <SheetNote error={error} />
        {sku && skuIndex >= 0 ? (
          <div className="space-y-4">
            <Field id="sku-name" label="Name">
              {(props) => (
                <Input
                  {...props}
                  value={sku.name}
                  onChange={(e) => patchPack(skuIndex, { name: e.target.value })}
                />
              )}
            </Field>
            <Field
              id="sku-month"
              label="Monthly KES"
              hint={`Per year ${packagePriceLabel(annualPriceKes(sku.monthlyPriceKes, rates.annualDiscountPercent))}`}
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  value={sku.monthlyPriceKes}
                  onChange={(e) => patchPack(skuIndex, { monthlyPriceKes: Number(e.target.value) })}
                />
              )}
            </Field>
            {(
              [
                ["Seats", "seats", sku.seats],
                ["Minutes", "minutes", sku.minutes],
                ["SMS", "sms", sku.sms],
                ["Email", "email", sku.email],
                ["WhatsApp", "staffWa", sku.staffWa],
                ["Number", "dids", sku.dids],
              ] as const
            ).map(([label, key, value]) => (
              <Field key={key} id={`sku-${key}`} label={label}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    value={value}
                    onChange={(e) => patchPack(skuIndex, { [key]: Number(e.target.value) })}
                  />
                )}
              </Field>
            ))}
            <div className="flex min-h-11 items-center justify-between gap-3">
              <p className="text-body font-medium text-ink">Live</p>
              <Switch
                checked={sku.isActive}
                onCheckedChange={(next) => patchPack(skuIndex, { isActive: next })}
                label={`${sku.name} live on landing`}
              />
            </div>
          </div>
        ) : null}
      </Sheet>

    </>
  );
}

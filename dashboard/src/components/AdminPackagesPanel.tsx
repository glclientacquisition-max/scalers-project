"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { Switch } from "@/components/ui/Switch";
import {
  inboundKesPerMinute,
  kesPerSecondFromMinute,
  outboundKesPerMinute,
  type BillingPackage,
  type BillingRateCard,
  type TenantSubscriptionRow,
} from "@/lib/packageCatalog";
import { formatKes } from "@/lib/packagePriceLabel";
import { requestErrorText } from "@/lib/adminBillingCopy";

type SheetKind = "rates" | "sku";

function shopMoneyHref(tenantId: string) {
  return `/admin/businesses/${tenantId}?money=1`;
}

function SheetNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="pb-3 text-body text-attention" role="alert">
      {error}
    </p>
  );
}

function adminMoney(amount: number) {
  if (!(amount > 0)) return "Not set";
  return `KSh ${formatKes(amount)}`;
}

function skuPreview(pack: BillingPackage) {
  return `${adminMoney(pack.monthlyPriceKes)} · Per year ${adminMoney(pack.annualPriceKes)}`;
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
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [skuId, setSkuId] = useState<string | null>(null);

  const inboundMin = inboundKesPerMinute(rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(rates.outboundKesPerSecond);

  const sku = packs.find((pack) => pack.id === skuId) || null;
  const skuIndex = packs.findIndex((pack) => pack.id === skuId);
  const needsYou = businesses.filter((row) => !row.packageName);

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
                href={shopMoneyHref(row.tenantId)}
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
            preview={`Inbound KSh ${formatKes(inboundMin)}/min · Year -${rates.annualDiscountPercent}%`}
            onOpen={openRates}
          />
        </ul>
      </section>

      <section>
        <p className="px-4 text-caption text-ink-3">Packages</p>
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

        {packs.length === 0 ? (
          <Empty title="No packages." line="Add a SKU in the catalogue." />
        ) : (
          <ul className="divide-y divide-hairline">
            {packs.map((pack) => (
              <ListRow
                key={pack.id}
                title={pack.name}
                preview={skuPreview(pack)}
                when={`${pack.minutes.toLocaleString("en-KE")} min`}
                stamp={<Stamp tone={pack.isActive ? "live" : "neutral"}>{pack.isActive ? "Live" : "Hidden"}</Stamp>}
                onOpen={() => openSku(pack.id)}
              />
            ))}
          </ul>
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
          <Field id="rate-in" label="Inbound KSh / min" hint={`KSh ${formatKes(rates.inboundKesPerSecond)}/sec`}>
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
            label="Outbound KSh / min"
            hint={`KSh ${formatKes(rates.outboundKesPerSecond)}/sec. Hidden until live transfer.`}
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
          <Field id="rate-wa" label="WhatsApp KSh">
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
          <Field id="rate-sms" label="SMS KSh / segment">
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
          <Field id="rate-email" label="Email KSh">
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
              label="Monthly KSh"
              hint={`Per year ${adminMoney(sku.annualPriceKes)}`}
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

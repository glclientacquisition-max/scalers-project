"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { Switch } from "@/components/ui/Switch";
import { requestErrorText } from "@/lib/adminBillingCopy";
import {
  inboundKesPerMinute,
  kesPerSecondFromMinute,
  outboundKesPerMinute,
} from "@/lib/packageCatalog";
import { formatKes } from "@/lib/packagePriceLabel";
import {
  packageVersionFromUnknown,
  type BusinessPlanRow,
  type PackageVersionCatalog,
  type PackageVersionRow,
  type VersionFeature,
  type VersionPackage,
} from "@/lib/packageVersionCatalog";

type Tab = "versions" | "businesses" | "catalogue";
type SheetKind = "edit" | "publish" | "discard" | "move" | "billing" | "signup" | null;

type DraftForm = {
  versionId: string;
  sku: string;
  name: string;
  monthly: string;
  seats: string;
  minutes: string;
  dids: string;
  credits: string;
  smsBurn: string;
  whatsappBurn: string;
  emailBurn: string;
  inboundMin: string;
  outboundMin: string;
  annual: string;
  creditKes: string;
  spendShare: string;
  extraSeat: string;
  hasExtraSeat: boolean;
  trialDays: string;
  onDemand: boolean;
  notes: string;
  features: VersionFeature[];
  allowancesPlaceholder: boolean;
};

function money(amount: number) {
  return `KSh ${formatKes(amount)}`;
}

function impliedDiscount(monthly: string, annual: string): string {
  const month = Number(monthly);
  const year = Number(annual);
  if (!Number.isFinite(month) || !Number.isFinite(year) || month <= 0 || year < 0) return "0";
  const percent = (1 - year / (month * 12)) * 100;
  if (!Number.isFinite(percent)) return "0";
  return String(Math.round(percent * 100) / 100);
}

function planPreview(version: PackageVersionRow) {
  const credits = version.messageCredits === null ? "Credits not set" : `${version.messageCredits.toLocaleString("en-KE")} credits`;
  return `${money(version.monthlyPriceKes)} · ${version.minutes.toLocaleString("en-KE")} min · ${credits}`;
}

function publishedOf(pack: VersionPackage): PackageVersionRow | null {
  const rows = pack.versions.filter((version) => version.status === "published");
  return rows[rows.length - 1] || null;
}

function draftOf(pack: VersionPackage): PackageVersionRow | null {
  return pack.versions.find((version) => version.status === "draft") || null;
}

function formFrom(
  pack: VersionPackage,
  version: PackageVersionRow,
  features: VersionFeature[],
  extraSeatSupported: boolean,
): DraftForm {
  const enabled = new Map(version.features.map((feature) => [feature.key, feature.enabled]));
  return {
    versionId: version.id,
    sku: pack.sku,
    name: pack.name,
    monthly: String(version.monthlyPriceKes),
    seats: String(version.seats),
    minutes: String(version.minutes),
    dids: String(version.dids),
    credits: version.messageCredits === null ? "" : String(version.messageCredits),
    smsBurn: version.smsCreditBurn === null ? "1" : String(version.smsCreditBurn),
    whatsappBurn: version.whatsappCreditBurn === null ? "2" : String(version.whatsappCreditBurn),
    emailBurn: version.emailCreditBurn === null ? "1" : String(version.emailCreditBurn),
    inboundMin: String(inboundKesPerMinute(version.inboundKesPerSecond)),
    outboundMin: String(outboundKesPerMinute(version.outboundKesPerSecond)),
    annual: String(version.annualPriceKes),
    creditKes: String(version.creditKes),
    spendShare: String(version.spendLimitSharePercent),
    extraSeat: version.extraSeatMonthlyKes === null ? "" : String(version.extraSeatMonthlyKes),
    hasExtraSeat: extraSeatSupported,
    trialDays: version.trialDays === null ? "" : String(version.trialDays),
    onDemand: version.onDemandAllowed,
    notes: version.notes || "",
    allowancesPlaceholder: version.allowancesPlaceholder,
    features: features.map((feature) => ({
      ...feature,
      enabled: enabled.get(feature.key) ?? feature.enabled,
    })),
  };
}

function patchFrom(form: DraftForm) {
  return {
    monthly_price_kes: Number(form.monthly),
    seats: Number(form.seats),
    minutes: Number(form.minutes),
    dids: Number(form.dids),
    message_credits: Number(form.credits),
    sms_credit_burn: Number(form.smsBurn),
    whatsapp_credit_burn: Number(form.whatsappBurn),
    email_credit_burn: Number(form.emailBurn),
    inbound_kes_per_second: kesPerSecondFromMinute(Number(form.inboundMin)),
    outbound_kes_per_second: kesPerSecondFromMinute(Number(form.outboundMin)),
    annual_price_kes: Number(form.annual),
    credit_kes: Number(form.creditKes),
    spend_limit_share_percent: Number(form.spendShare),
    ...(form.hasExtraSeat
      ? { extra_seat_monthly_kes: form.extraSeat.trim() === "" ? null : Number(form.extraSeat) }
      : {}),
    trial_days: form.sku === "trial" ? Number(form.trialDays) : null,
    allowances_placeholder: form.allowancesPlaceholder,
    on_demand_allowed: form.onDemand,
    notes: form.notes.trim() || null,
    features: form.features.map((feature) => ({ key: feature.key, enabled: feature.enabled })),
  };
}

function changedLines(before: PackageVersionRow, form: DraftForm): string[] {
  const lines: string[] = [];
  const add = (label: string, from: string, to: string) => {
    if (from !== to) lines.push(`${label}: ${from} to ${to}`);
  };
  const minuteLabel = form.sku === "trial" ? "Trial minutes" : "Minutes";
  const creditLabel = form.sku === "trial" ? "Trial credits" : "Credits";
  add("Monthly", money(before.monthlyPriceKes), money(Number(form.monthly)));
  add("Annual", money(before.annualPriceKes), money(Number(form.annual)));
  add("Implied discount", `${before.annualDiscountPercent}%`, `${impliedDiscount(form.monthly, form.annual)}%`);
  add(minuteLabel, String(before.minutes), form.minutes);
  add("Seats", String(before.seats), form.seats);
  add(creditLabel, before.messageCredits === null ? "Not set" : String(before.messageCredits), form.credits || "Not set");
  add("Numbers", String(before.dids), form.dids);
  if (form.hasExtraSeat) {
    add(
      "Extra seat",
      before.extraSeatMonthlyKes === null ? "Not set" : money(before.extraSeatMonthlyKes),
      form.extraSeat.trim() === "" ? "Not set" : money(Number(form.extraSeat)),
    );
  }
  add("SMS burn", String(before.smsCreditBurn ?? ""), form.smsBurn);
  add("WhatsApp burn", String(before.whatsappCreditBurn ?? ""), form.whatsappBurn);
  add("Email burn", String(before.emailCreditBurn ?? ""), form.emailBurn);
  add("Inbound", `${inboundKesPerMinute(before.inboundKesPerSecond)} / min`, `${form.inboundMin} / min`);
  add("Outbound", `${outboundKesPerMinute(before.outboundKesPerSecond)} / min`, `${form.outboundMin} / min`);
  add("Credit price", money(before.creditKes), money(Number(form.creditKes)));
  add("Spend limit", `${before.spendLimitSharePercent}%`, `${form.spendShare}%`);
  if (form.sku === "trial") {
    add("Trial days", String(before.trialDays ?? ""), form.trialDays);
  }
  add("On-demand", before.onDemandAllowed ? "On" : "Off", form.onDemand ? "On" : "Off");
  return lines;
}

export function AdminPackageVersionsPanel({
  catalog,
  businesses,
  children,
}: {
  catalog: PackageVersionCatalog;
  businesses: BusinessPlanRow[];
  children?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("versions");
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [reason, setReason] = useState("");
  const [starts, setStarts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [targetVersionId, setTargetVersionId] = useState("");
  const [nextBeta, setNextBeta] = useState(true);
  const [nextEnforcement, setNextEnforcement] = useState<"off" | "soft" | "hard">("off");
  const [signupEnabled, setSignupEnabled] = useState(catalog.newSignupTrialEnabled);

  const featureCatalog = useMemo<VersionFeature[]>(
    () => catalog.features.map((feature) => ({ ...feature, enabled: false })),
    [catalog.features],
  );
  const packs = catalog.packages;
  const trial = packs.find((pack) => pack.sku === "trial") || null;
  const trialLive = trial ? publishedOf(trial) : null;
  const business = businesses.find((row) => row.tenantId === businessId) || null;
  const publishedChoices = packs.flatMap((pack) =>
    pack.versions
      .filter((version) => version.status === "published")
      .map((version) => ({ id: version.id, label: `${pack.name} version ${version.version}` })),
  );
  const target = publishedChoices.find((choice) => choice.id === targetVersionId) || null;

  function closeSheet() {
    if (pending) return;
    setSheet(null);
    setError(null);
  }

  async function post(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/package-versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(requestErrorText(json, "Could not save. Nothing changed."));
      return null;
    }
    return json as Record<string, unknown>;
  }

  function openEdit(pack: VersionPackage, version: PackageVersionRow) {
    setError(null);
    setReason("");
    setForm(formFrom(pack, version, featureCatalog.length ? featureCatalog : version.features, catalog.extraSeatSupported));
    setSheet("edit");
  }

  async function createDraft(pack: VersionPackage) {
    const existing = draftOf(pack);
    if (existing) {
      openEdit(pack, existing);
      return;
    }
    setError(null);
    setStatus(null);
    const json = await post({ action: "draft", sku: pack.sku, reason: `Open a ${pack.name} draft` });
    if (!json) return;
    const opened = packageVersionFromUnknown(json.version);
    if (opened) openEdit(pack, opened);
    setStatus(`${pack.name} draft opened.`);
    startTransition(() => router.refresh());
  }

  async function saveDraft(next: "stay" | "publish") {
    if (!form) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    const saved = await post({
      action: "update_draft",
      version_id: form.versionId,
      patch: patchFrom(form),
      reason: reason.trim(),
    });
    if (!saved) return;
    if (next === "publish") {
      setSheet("publish");
      return;
    }
    setStatus("Draft saved.");
    setSheet(null);
    startTransition(() => router.refresh());
  }

  async function publishDraft() {
    if (!form || !reason.trim()) return;
    const when = starts
      ? new Date(`${starts}T00:00:00+03:00`).toISOString()
      : new Date().toISOString();
    const published = await post({
      action: "publish",
      version_id: form.versionId,
      active_from: when,
      reason: reason.trim(),
    });
    if (!published) return;
    setStatus(`${form.name} published.`);
    setSheet(null);
    startTransition(() => router.refresh());
  }

  async function discardDraft() {
    if (!form || !reason.trim()) return;
    const discarded = await post({
      action: "discard_draft",
      version_id: form.versionId,
      reason: reason.trim(),
    });
    if (!discarded) return;
    setStatus("Draft discarded.");
    setSheet(null);
    startTransition(() => router.refresh());
  }

  async function moveBusiness() {
    if (!business || !targetVersionId || !reason.trim()) return;
    const moved = await post({
      action: "move_subscribers",
      version_id: targetVersionId,
      tenant_ids: [business.tenantId],
      reason: reason.trim(),
      confirm: true,
    });
    if (!moved) return;
    setStatus(`${business.businessName} moved.`);
    setSheet(null);
    startTransition(() => router.refresh());
  }

  async function saveBilling() {
    if (!business || !reason.trim()) return;
    const saved = await post({
      action: "set_billing_mode",
      tenant_id: business.tenantId,
      billing_status: nextBeta ? "beta" : "active",
      enforcement: nextEnforcement,
      reason: reason.trim(),
      confirm: true,
    });
    if (!saved) return;
    setStatus(`${business.businessName} updated.`);
    setSheet(null);
    startTransition(() => router.refresh());
  }

  async function saveSignup() {
    if (!reason.trim()) return;
    const saved = await post({
      action: "set_new_signup_trial",
      enabled: signupEnabled,
      reason: reason.trim(),
      confirm: true,
    });
    if (!saved) return;
    setStatus(signupEnabled ? "New signups get a trial." : "New signups stay without a trial.");
    setSheet(null);
    startTransition(() => router.refresh());
  }

  function openMove(row: BusinessPlanRow) {
    setBusinessId(row.tenantId);
    setTargetVersionId(row.versionId || "");
    setReason("");
    setError(null);
    setSheet("move");
  }

  function openBilling(row: BusinessPlanRow, beta: boolean, enforcement: "off" | "soft" | "hard") {
    setBusinessId(row.tenantId);
    setNextBeta(beta);
    setNextEnforcement(enforcement);
    setReason("");
    setError(null);
    setSheet("billing");
  }

  const billingBlocked = !nextBeta && nextEnforcement === "off" && business?.billingStatus === "beta";
  const baselinePack = form ? packs.find((pack) => pack.sku === form.sku) : null;
  const baseline = baselinePack ? publishedOf(baselinePack) : null;
  const diff = form && baseline ? changedLines(baseline, form) : [];

  return (
    <div className="space-y-4">
      <Segmented
        label="Packages"
        items={[
          { key: "versions", label: "Versions", active: tab === "versions" },
          { key: "businesses", label: "Businesses", count: businesses.length, active: tab === "businesses" },
          { key: "catalogue", label: "Catalogue", active: tab === "catalogue" },
        ]}
        onSelect={(key) => setTab(key as Tab)}
      />

      {status ? <p className="px-4 text-body text-ink-2">{status}</p> : null}
      {error && sheet === null ? (
        <p className="px-4 text-body text-attention" role="alert">{error}</p>
      ) : null}

      {tab === "catalogue" ? children : null}

      {tab === "versions" ? (
        <div className="space-y-6">
          {trial && trialLive ? (
            <section>
              <p className="px-4 text-caption text-ink-3">Trial</p>
              <ul className="divide-y divide-hairline">
                <ListRow
                  title="Trial"
                  preview={`${trialLive.trialDays ?? 0} days · ${trialLive.minutes} min · ${trialLive.messageCredits ?? 0} credits · On-demand ${trialLive.onDemandAllowed ? "on" : "off"}`}
                  stamp={<Stamp tone={trialLive.onDemandAllowed ? "attention" : "neutral"}>Version {trialLive.version}</Stamp>}
                  onOpen={() => void createDraft(trial)}
                />
              </ul>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body text-ink">New signups get a trial</p>
                  <p className="text-meta text-ink-2">Off until you confirm. Existing businesses stay as they are.</p>
                </div>
                <Switch
                  checked={catalog.newSignupTrialEnabled}
                  label="New signups get a trial"
                  onCheckedChange={(next) => {
                    setSignupEnabled(next);
                    setReason("");
                    setError(null);
                    setSheet("signup");
                  }}
                />
              </div>
              <div className="px-4">
                <Button variant="tonal" size="sm" onClick={() => void createDraft(trial)} pending={pending}>
                  {draftOf(trial) ? "Edit trial draft" : "Edit trial"}
                </Button>
              </div>
            </section>
          ) : null}

          {packs.length === 0 ? (
            <Empty title="No plans" line="Publish a package version and it shows up here." />
          ) : (
            packs.filter((pack) => pack.sku !== "trial").map((pack) => (
              <section key={pack.id}>
                <div className="flex items-center justify-between gap-3 px-4">
                  <p className="text-caption text-ink-3">{pack.name}</p>
                  <Button variant="ghost" size="sm" onClick={() => void createDraft(pack)}>
                    {draftOf(pack) ? "Edit draft" : "New draft"}
                  </Button>
                </div>
                <ul className="divide-y divide-hairline">
                  {pack.versions.map((version) => (
                    <ListRow
                      key={version.id}
                      title={`Version ${version.version}`}
                      preview={planPreview(version)}
                      when={version.subscriberCount ? String(version.subscriberCount) : undefined}
                      stamp={
                        <Stamp tone={version.status === "draft" ? "attention" : version.status === "retired" ? "neutral" : "ok"}>
                          {version.status === "draft" ? "Draft" : version.status === "retired" ? "Retired" : "Published"}
                        </Stamp>
                      }
                      onOpen={
                        version.status === "retired"
                          ? undefined
                          : () => {
                              if (version.status === "draft") openEdit(pack, version);
                              else void createDraft(pack);
                            }
                      }
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}

      {tab === "businesses" ? (
        businesses.length === 0 ? (
          <Empty title="No businesses" line="A signup creates a business, then you can move it onto a plan." />
        ) : (
          <ul className="divide-y divide-hairline">
            {businesses.map((row) => (
              <ListRow
                key={row.tenantId}
                title={row.businessName}
                preview={
                  row.packageName
                    ? `${row.packageName} version ${row.version} · ${row.minutesIncluded.toLocaleString("en-KE")} min · Billing ${row.billingEnforcement === "off" ? "off" : row.billingEnforcement}`
                    : "No plan"
                }
                stamp={
                  row.billingStatus === "beta" ? (
                    <Stamp>Beta</Stamp>
                  ) : row.billingEnforcement === "off" ? (
                    <Stamp tone="attention">Billing off</Stamp>
                  ) : (
                    <Stamp tone="ok">Billing on</Stamp>
                  )
                }
                onOpen={() => openMove(row)}
                actions={
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => openBilling(row, row.billingStatus === "beta", row.billingEnforcement)}
                  >
                    Beta
                  </Button>
                }
              />
            ))}
          </ul>
        )
      ) : null}

      <Sheet
        open={sheet === "edit"}
        title={form ? `${form.name} draft` : "Draft"}
        theme="admin"
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setSheet("discard")} disabled={pending || !form}>
              Discard
            </Button>
            <Button variant="tonal" size="md" pending={pending} onClick={() => void saveDraft("stay")}>
              Save
            </Button>
            <Button variant="primary" size="md" pending={pending} onClick={() => void saveDraft("publish")}>
              Publish
            </Button>
          </>
        }
      >
        {error ? <p className="pb-3 text-body text-attention" role="alert">{error}</p> : null}
        {form ? (
          <div className="space-y-4">
            <Field id="version-monthly" label="Monthly price" required>
              {(props) => (
                <Input {...props} inputMode="decimal" value={form.monthly} onChange={(event) => setForm({ ...form, monthly: event.target.value })} />
              )}
            </Field>
            <Field id="version-annual" label="Annual price" hint={`Implied discount ${impliedDiscount(form.monthly, form.annual)}%`} required>
              {(props) => (
                <Input {...props} inputMode="decimal" value={form.annual} onChange={(event) => setForm({ ...form, annual: event.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="version-minutes" label={form.sku === "trial" ? "Trial minutes" : "Minutes"} required>
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.minutes} onChange={(event) => setForm({ ...form, minutes: event.target.value })} />
                )}
              </Field>
              <Field id="version-credits" label={form.sku === "trial" ? "Trial credits" : "Credits"} required>
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} />
                )}
              </Field>
              <Field id="version-seats" label="Seats" required>
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.seats} onChange={(event) => setForm({ ...form, seats: event.target.value })} />
                )}
              </Field>
              <Field id="version-numbers" label="Numbers" required>
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.dids} onChange={(event) => setForm({ ...form, dids: event.target.value })} />
                )}
              </Field>
            </div>
            {form.hasExtraSeat ? (
              <Field id="version-extra-seat" label="Extra seat (KSh / month)">
                {(props) => (
                  <Input {...props} inputMode="decimal" value={form.extraSeat} onChange={(event) => setForm({ ...form, extraSeat: event.target.value })} />
                )}
              </Field>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              <Field id="version-sms" label="SMS burn" hint={`1 credit = ${money(Number(form.creditKes) || 0)}`}>
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.smsBurn} onChange={(event) => setForm({ ...form, smsBurn: event.target.value })} />
                )}
              </Field>
              <Field id="version-wa" label="WhatsApp burn">
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.whatsappBurn} onChange={(event) => setForm({ ...form, whatsappBurn: event.target.value })} />
                )}
              </Field>
              <Field id="version-email" label="Email burn">
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.emailBurn} onChange={(event) => setForm({ ...form, emailBurn: event.target.value })} />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field id="version-in" label="Inbound / min">
                {(props) => (
                  <Input {...props} inputMode="decimal" value={form.inboundMin} onChange={(event) => setForm({ ...form, inboundMin: event.target.value })} />
                )}
              </Field>
              <Field id="version-out" label="Outbound / min">
                {(props) => (
                  <Input {...props} inputMode="decimal" value={form.outboundMin} onChange={(event) => setForm({ ...form, outboundMin: event.target.value })} />
                )}
              </Field>
              <Field id="version-credit-kes" label="Credit price">
                {(props) => (
                  <Input {...props} inputMode="decimal" value={form.creditKes} onChange={(event) => setForm({ ...form, creditKes: event.target.value })} />
                )}
              </Field>
              <Field id="version-spend" label="Spend limit %" hint="Share of the monthly price">
                {(props) => (
                  <Input {...props} inputMode="decimal" value={form.spendShare} onChange={(event) => setForm({ ...form, spendShare: event.target.value })} />
                )}
              </Field>
            </div>
            {form.sku === "trial" ? (
              <Field id="version-days" label="Trial days" required>
                {(props) => (
                  <Input {...props} inputMode="numeric" value={form.trialDays} onChange={(event) => setForm({ ...form, trialDays: event.target.value })} />
                )}
              </Field>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-body text-ink">On-demand</p>
              <Switch
                checked={form.onDemand}
                label="On-demand"
                onCheckedChange={(next) => setForm({ ...form, onDemand: next })}
              />
            </div>
            {form.features.length > 0 ? (
              <ul className="divide-y divide-hairline">
                {form.features.map((feature) => (
                  <li key={feature.key} className="flex items-center justify-between gap-3 py-2">
                    <p className="text-body text-ink">{feature.label}</p>
                    <Switch
                      checked={feature.enabled}
                      label={feature.label}
                      onCheckedChange={(next) =>
                        setForm({
                          ...form,
                          features: form.features.map((item) =>
                            item.key === feature.key ? { ...item, enabled: next } : item,
                          ),
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <Field id="version-notes" label="Notes">
              {(props) => (
                <Textarea {...props} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              )}
            </Field>
            <Field id="version-reason" label="Reason" required>
              {(props) => (
                <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
              )}
            </Field>
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={sheet === "publish"}
        title="Publish this version"
        theme="admin"
        pending={pending}
        confirmLabel="Publish"
        confirmDisabled={!reason.trim()}
        onClose={() => setSheet("edit")}
        onConfirm={() => void publishDraft()}
      >
        {error ? <p className="pb-3 text-body text-attention" role="alert">{error}</p> : null}
        {diff.length === 0 ? (
          <p>No price or allowance changed from the published version.</p>
        ) : (
          <ul className="space-y-1">
            {diff.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-4">
          <Field id="publish-starts" label="Starts" hint="Blank publishes now. East Africa time.">
            {(props) => <Input {...props} type="date" value={starts} onChange={(event) => setStarts(event.target.value)} />}
          </Field>
          <Field id="publish-reason" label="Reason" required>
            {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={sheet === "discard"}
        title="Discard this draft"
        theme="admin"
        danger
        pending={pending}
        confirmLabel="Discard"
        confirmDisabled={!reason.trim()}
        onClose={() => setSheet("edit")}
        onConfirm={() => void discardDraft()}
      >
        <p>The published version stays.</p>
        <div className="mt-4">
          <Field id="discard-reason" label="Reason" required>
            {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={sheet === "move"}
        title={business ? `Move ${business.businessName}` : "Move business"}
        theme="admin"
        pending={pending}
        confirmLabel="Move"
        confirmDisabled={!reason.trim() || !targetVersionId}
        onClose={closeSheet}
        onConfirm={() => void moveBusiness()}
      >
        {error ? <p className="pb-3 text-body text-attention" role="alert">{error}</p> : null}
        <p>
          From {business?.packageName ? `${business.packageName} version ${business.version}` : "no plan"}
          {target ? ` to ${target.label}` : ""}. Beta and billing stay as they are. Minutes follow the new version.
        </p>
        <div className="mt-4 space-y-4">
          <Field id="move-version" label="Plan">
            {(props) => (
              <Select {...props} value={targetVersionId} onChange={(event) => setTargetVersionId(event.target.value)}>
                <option value="">Choose a version</option>
                {publishedChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>{choice.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="move-reason" label="Reason" required>
            {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
          {business ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-body text-ink">Beta</p>
                <p className="text-meta text-ink-2">{business.billingStatus === "beta" ? "On" : "Off"}</p>
              </div>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => openBilling(business, business.billingStatus !== "beta", business.billingEnforcement)}
              >
                Change beta
              </Button>
            </div>
          ) : null}
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={sheet === "billing"}
        title={business ? business.businessName : "Billing"}
        theme="admin"
        pending={pending}
        confirmLabel="Save"
        confirmDisabled={!reason.trim() || billingBlocked}
        onClose={closeSheet}
        onConfirm={() => void saveBilling()}
      >
        {error ? <p className="pb-3 text-body text-attention" role="alert">{error}</p> : null}
        <p>
          {nextBeta ? "Beta stays on." : "Beta turns off."} Billing {nextEnforcement === "off" ? "stays off" : "turns on"}.
          {" "}The plan does not change.
        </p>
        {billingBlocked ? (
          <p className="mt-2 text-attention">Turn billing on before taking this business off beta.</p>
        ) : null}
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-ink">Beta</p>
            <Switch checked={nextBeta} label="Beta" onCheckedChange={setNextBeta} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-ink">Billing</p>
            <Switch
              checked={nextEnforcement !== "off"}
              label="Billing"
              onCheckedChange={(on) => setNextEnforcement(on ? (business?.billingEnforcement === "hard" ? "hard" : "soft") : "off")}
            />
          </div>
          <Field id="billing-reason" label="Reason" required>
            {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={sheet === "signup"}
        title="New signups"
        theme="admin"
        pending={pending}
        confirmLabel={signupEnabled ? "Turn on" : "Turn off"}
        confirmDisabled={!reason.trim()}
        onClose={() => {
          setSignupEnabled(catalog.newSignupTrialEnabled);
          closeSheet();
        }}
        onConfirm={() => void saveSignup()}
      >
        {error ? <p className="pb-3 text-body text-attention" role="alert">{error}</p> : null}
        <p>
          {signupEnabled
            ? "A new business is pinned to the latest trial version. Billing stays off."
            : "A new business gets no trial. Existing businesses stay as they are."}
        </p>
        <div className="mt-4">
          <Field id="signup-reason" label="Reason" required>
            {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
        </div>
      </ConfirmSheet>
    </div>
  );
}

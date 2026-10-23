"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { AdminBillingClientDetail } from "@/lib/adminBilling";
import { AdminShopMoneyPanel } from "@/components/AdminShopMoneyPanel";
import type { QualityBadge } from "@/lib/adminQualityModel";
import { formatScore } from "@/lib/adminQualityModel";
import {
  ARCHIVE_RESTORE_DAYS,
  formatCreated,
  hasLiveNumber,
  lifecycleOf,
  notifyLabel,
  phoneLine,
  purgeLabel,
  releaseReason,
  SUSPENDED_LINE,
} from "@/lib/adminBusinessUi";
import { reasonOk, resumeBillingOffer } from "@/lib/adminBusinessModel";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { Switch } from "@/components/ui/Switch";
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  RETENTION_NEVER,
} from "@/lib/recordingRetentionPolicy";

type TenantRetentionMode = "default" | "days" | "never";

function tenantRetentionInit(override: number | null): { mode: TenantRetentionMode; days: string } {
  if (override === RETENTION_NEVER) return { mode: "never", days: "30" };
  if (override != null) return { mode: "days", days: String(override) };
  return { mode: "default", days: "30" };
}

function tenantRetentionStored(mode: TenantRetentionMode, days: string): number | null {
  if (mode === "default") return null;
  if (mode === "never") return RETENTION_NEVER;
  const n = Math.floor(Number(days));
  if (n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS) return n;
  return RETENTION_MIN_DAYS;
}

function tenantRetentionLabel(override: number | null): string {
  if (override === RETENTION_NEVER) return "Never delete";
  if (override != null) return `${override} days`;
  return "Platform default";
}

type SheetKind = "assign" | "release" | "lifecycle" | "edit" | "recording";
type LifecycleAction = "suspend" | "unsuspend" | "archive" | "restore";
const LIFECYCLE: Record<
  LifecycleAction,
  { title: string; confirm: string; danger?: boolean; body: (b: AdminBusiness) => string }
> = {
  suspend: {
    title: "Suspend this line?",
    confirm: "Suspend",
    danger: true,
    body: (b) =>
      `Callers to ${b.business_name} hear that the line is unavailable. Refused calls are not charged. Calls, contacts, package and billing stay as they are.`,
  },
  unsuspend: {
    title: "Restore this line?",
    confirm: "Restore line",
    body: (b) => `${b.business_name} starts taking calls again.`,
  },
  archive: {
    title: "Archive this business?",
    confirm: "Archive",
    danger: true,
    body: (b) =>
      `The line closes, charging stops, and the owner can't sign in. ${b.business_name} leaves the main list. Unarchive within ${ARCHIVE_RESTORE_DAYS} days. After that its calls, recordings, contacts and setup are deleted. Billing records stay.`,
  },
  restore: {
    title: "Unarchive this business?",
    confirm: "Unarchive",
    body: (b) =>
      `${b.business_name} goes back on the list, the owner can sign in, and the line opens.`,
  },
};

function SheetNote({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p className="pb-3 text-ops-body text-attention" role="alert">
      {error}
    </p>
  );
}

export function AdminShopPanel({
  business,
  badge,
  availableDids,
  freeCount,
  billing,
  focusMoney,
}: {
  business: AdminBusiness;
  badge?: QualityBadge;
  availableDids: { e164: string }[];
  freeCount: number;
  billing?: AdminBillingClientDetail | null;
  focusMoney?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleAction>("suspend");
  const [reason, setReason] = useState("");
  const [resumeBilling, setResumeBilling] = useState(false);
  const [editName, setEditName] = useState(business.business_name);
  const [editNotify, setEditNotify] = useState(business.whatsapp_notification_number);
  const [recordingMode, setRecordingMode] = useState<TenantRetentionMode>("default");
  const [recordingDays, setRecordingDays] = useState("30");
  const moneyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focusMoney) return;
    moneyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusMoney]);

  async function run(body: Record<string, unknown>, url = "/api/admin/businesses") {
    setError("");
    setStatus("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error || "Could not save.");
      return false;
    }
    setReason("");
    setSheet(null);
    setStatus("Saved.");
    startTransition(() => router.refresh());
    return true;
  }

  function openLifecycle(action: LifecycleAction) {
    setLifecycle(action);
    setReason("");
    setResumeBilling(false);
    setSheet("lifecycle");
  }

  const b = business;
  const life = lifecycleOf(b);

  return (
    <div className="space-y-8">
      {error ? (
        <p className="px-4 text-ops-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="px-4 text-ops-body text-ok" role="status">
          {status}
        </p>
      ) : null}

      <ShopBlock title="Line">
        {b.status === "suspended" ? (
          <ListRow title="Status" preview={SUSPENDED_LINE} stamp={<Stamp tone="attention">Suspended</Stamp>} />
        ) : null}
        {b.status === "archived" ? (
          <ListRow title="Status" preview={purgeLabel(b)} stamp={<Stamp tone="neutral">Archived</Stamp>} />
        ) : null}
        <ListRow title="Number" preview={phoneLine(b)} />
        {badge ? (
          <ListRow
            title="Quality"
            href={`/admin/quality/${b.id}`}
            preview={badge.dropping ? badge.droppingReason : formatScore(badge.score ?? null)}
            stamp={
              badge.dropping ? (
                <Stamp tone="attention">Dropping</Stamp>
              ) : (
                <Stamp tone="neutral">{formatScore(badge.score ?? null)}</Stamp>
              )
            }
          />
        ) : null}
        {b.status === "waiting" ? (
          <ListRow
            title="Assign"
            preview={freeCount > 0 ? "Pick a number" : "Add a number"}
            onOpen={freeCount > 0 ? () => setSheet("assign") : undefined}
            href={freeCount > 0 ? undefined : "/admin/numbers"}
          />
        ) : null}
        {hasLiveNumber(b) ? (
          releaseReason(b) ? (
            <ListRow
              title="Release number"
              preview={
                <span id={`release-why-${b.id}`} title={releaseReason(b) || undefined}>
                  Live. Archive the business first.
                </span>
              }
              actions={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-describedby={`release-why-${b.id}`}
                >
                  Release
                </Button>
              }
            />
          ) : (
            <ListRow title="Release number" preview={b.sautikit_virtual_number} onOpen={() => setSheet("release")} />
          )
        ) : null}
      </ShopBlock>

      <ShopBlock title="Shop">
        <ListRow
          title="Business details"
          preview={b.business_name}
          onOpen={() => {
            setEditName(b.business_name);
            setEditNotify(b.whatsapp_notification_number);
            setSheet("edit");
          }}
        />
        <ListRow title="Notify" preview={notifyLabel(b.whatsapp_notification_number)} />
        <ListRow title="Created" preview={formatCreated(b.created_at)} />
        <ListRow title="Activity" href={`/admin/activity?business=${b.id}`} preview="Who changed what, and when" />
        <ListRow
          title="Recording retention"
          preview={tenantRetentionLabel(b.recording_retention_days_override)}
          onOpen={() => {
            const init = tenantRetentionInit(b.recording_retention_days_override);
            setRecordingMode(init.mode);
            setRecordingDays(init.days);
            setSheet("recording");
          }}
        />
      </ShopBlock>

      <ShopBlock title="Money" sectionRef={moneyRef} id="shop-money">
        {billing ? (
          <AdminShopMoneyPanel detail={billing} />
        ) : (
          <ListRow title="Billing" preview="Could not load billing for this business." />
        )}
      </ShopBlock>

      <ShopBlock title="Line state">
        {life.state === "archived" ? (
          <ListRow
            title="Unarchive"
            preview={life.purgesAt ? `Until ${formatCreated(life.purgesAt)}` : "Back on the list"}
            onOpen={() => openLifecycle("restore")}
          />
        ) : (
          <>
            {life.state === "suspended" ? (
              life.byAdmin ? (
                <ListRow
                  title="Restore line"
                  preview="Start taking calls again"
                  onOpen={() => openLifecycle("unsuspend")}
                />
              ) : (
                <ListRow title="Restore line" preview="Suspended for non-payment. Comes back when paid." />
              )
            ) : (
              <ListRow
                title="Suspend"
                preview="Pause calls. Data and billing stay."
                onOpen={() => openLifecycle("suspend")}
              />
            )}
            <ListRow
              title="Archive"
              preview={`Close and hide. Unarchive within ${ARCHIVE_RESTORE_DAYS} days.`}
              onOpen={() => openLifecycle("archive")}
            />
          </>
        )}
      </ShopBlock>

      <Sheet
        open={sheet === "assign"}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title={b.business_name}
        theme="admin"
        footer={
          freeCount > 0 ? (
            <Button
              type="button"
              block
              pending={pending}
              onClick={() => void run({ action: "assign_next", business_id: b.id })}
            >
              Assign next
            </Button>
          ) : (
            <ButtonLink href="/admin/numbers" block>
              Add number
            </ButtonLink>
          )
        }
      >
        <SheetNote error={error} />
        {freeCount === 0 ? (
          <Empty className="px-0 py-8" title="No numbers available" line="Add a number, then assign." />
        ) : (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {availableDids.map((row) => (
              <ListRow
                key={row.e164}
                title={row.e164}
                onOpen={() =>
                  void run({ action: "assign_specific", tenant_id: b.id, e164: row.e164 }, "/api/did-pool")
                }
              />
            ))}
          </ul>
        )}
      </Sheet>

      <ConfirmSheet
        open={sheet === "release"}
        theme="admin"
        title="Release this number?"
        confirmLabel="Release"
        danger
        pending={pending}
        onClose={() => setSheet(null)}
        onConfirm={() => void run({ action: "release_did", business_id: b.id })}
      >
        <SheetNote error={error} />
        <p>
          {`${b.sautikit_virtual_number} returns to Available. ${b.business_name} waits for a new number.`}
        </p>
      </ConfirmSheet>

      <Sheet
        open={sheet === "recording"}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title="Recording retention"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={pending}
            onClick={() =>
              void run({
                action: "save_recording_retention",
                business_id: b.id,
                before_override: b.recording_retention_days_override,
                recording_retention_days_override: tenantRetentionStored(recordingMode, recordingDays),
              })
            }
          >
            Save
          </Button>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <Segmented
            className="-mx-5 px-5 sm:-mx-6 sm:px-6 md:-mx-6 md:px-6"
            label="Override"
            items={[
              { key: "default", label: "Platform", active: recordingMode === "default" },
              { key: "days", label: "Days", active: recordingMode === "days" },
              { key: "never", label: "Never", active: recordingMode === "never" },
            ]}
            onSelect={(key) => setRecordingMode(key as TenantRetentionMode)}
          />
          <Field id="tenant-recording-days" label="Delete after" hint="Days">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={RETENTION_MIN_DAYS}
                max={RETENTION_MAX_DAYS}
                step={1}
                className="tabular-nums"
                disabled={recordingMode !== "days"}
                value={recordingDays}
                onChange={(event) => {
                  setRecordingMode("days");
                  setRecordingDays(event.target.value);
                }}
              />
            )}
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={sheet === "edit"}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title="Business details"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={pending}
            disabled={!editName.trim()}
            onClick={() =>
              void run({
                action: "update_profile",
                business_id: b.id,
                business_name: editName.trim(),
                whatsapp_notification_number: editNotify.trim(),
              })
            }
          >
            Save
          </Button>
        }
      >
        <SheetNote error={error} />
        <Field id="shop-edit-name" label="Business name">
          {(props) => (
            <Input {...props} autoComplete="off" value={editName} onChange={(event) => setEditName(event.target.value)} />
          )}
        </Field>
        <Field id="shop-edit-notify" label="Notify number" hint="WhatsApp or SMS for owner alerts.">
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              inputMode="tel"
              value={editNotify}
              onChange={(event) => setEditNotify(event.target.value)}
            />
          )}
        </Field>
      </Sheet>

      <ConfirmSheet
        open={sheet === "lifecycle"}
        theme="admin"
        title={LIFECYCLE[lifecycle].title}
        confirmLabel={LIFECYCLE[lifecycle].confirm}
        danger={LIFECYCLE[lifecycle].danger}
        pending={pending}
        confirmDisabled={!reasonOk(reason)}
        onClose={() => {
          setReason("");
          setSheet(null);
        }}
        onConfirm={() =>
          void run({
            action: lifecycle,
            business_id: b.id,
            reason: reason.trim(),
            ...(lifecycle === "restore" ? { resume_billing: resumeBilling } : {}),
          })
        }
      >
        <SheetNote error={error} />
        <p className="pb-3">{LIFECYCLE[lifecycle].body(b)}</p>
        {lifecycle === "restore" ? (
          <RestoreBillingChoice
            offer={resumeBillingOffer(b.pre_archive)}
            checked={resumeBilling}
            onChange={setResumeBilling}
          />
        ) : null}
        <Field id="biz-lifecycle-reason" label="Reason" hint="3 characters or more. Shows in Activity.">
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </ConfirmSheet>
    </div>
  );
}

function ShopBlock({
  title,
  children,
  sectionRef,
  id,
}: {
  title: string;
  children: ReactNode;
  sectionRef?: React.RefObject<HTMLElement | null>;
  id?: string;
}) {
  return (
    <section ref={sectionRef} id={id} className="scroll-mt-4 space-y-1">
      <h2 className="px-4 text-caption text-ink-3">{title}</h2>
      <ul className="divide-y divide-hairline">{children}</ul>
    </section>
  );
}

function RestoreBillingChoice({
  offer,
  checked,
  onChange,
}: {
  offer: { label: string; summary: string } | null;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  if (!offer) {
    return <p className="pb-3">Charging stays off. Turn it on in Plan when you&apos;re ready.</p>;
  }
  return (
    <div
      data-restore-billing=""
      className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2"
    >
      <div className="min-w-0">
        <p className="text-ops-body font-medium text-ink">{offer.label}</p>
        <p className="text-meta text-ink-2">{offer.summary}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={offer.label} />
    </div>
  );
}

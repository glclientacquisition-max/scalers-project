"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { QualityBadge } from "@/lib/adminQualityModel";
import { formatScore } from "@/lib/adminQualityModel";
import type { PendingTenant } from "@/lib/didPool";
import type { WalletLedgerRow } from "@/lib/wallet";
import {
  ARCHIVE_RESTORE_DAYS,
  businessLifecycle,
  reasonOk,
  resumeBillingOffer,
  releaseBlockReason,
} from "@/lib/adminBusinessModel";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Switch } from "@/components/ui/Switch";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp, type StampTone } from "@/components/ui/Stamp";
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

const createdLabel = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});

/** "all" is every business that is not archived. Archived ones have their own filter. */
type ShopFilter = "all" | "waiting" | "active" | "suspended" | "archived";
type LifecycleAction = "suspend" | "unsuspend" | "archive" | "restore";
type SheetKind =
  | "shop"
  | "assign"
  | "release"
  | "plan"
  | "charges"
  | "package"
  | "lifecycle"
  | "recording";
type PlanChoice = "beta" | "on";
type PackOption = { id: string; name: string; isActive?: boolean };

function statusLabel(status: AdminBusiness["status"]) {
  if (status === "waiting") return "Waiting";
  if (status === "suspended") return "Suspended";
  if (status === "archived") return "Archived";
  return "Active";
}

function statusTone(status: AdminBusiness["status"]): StampTone {
  if (status === "waiting" || status === "suspended") return "attention";
  if (status === "active") return "ok";
  return "neutral";
}

function lifecycleOf(b: AdminBusiness) {
  return businessLifecycle({
    isActive: b.is_active,
    archivedAt: b.archived_at,
    lineStatus: b.line_status,
    suspendedAt: b.suspended_at,
  });
}

const SUSPENDED_LINE = "Suspended: line unavailable";

/** "Purges on 16 Nov 2026" (East Africa date), or a plain note when there is no archive date. */
function purgeLabel(b: AdminBusiness) {
  const life = lifecycleOf(b);
  if (life.state !== "archived" || !life.purgesAt) return "Archived before dates were kept. Not purged.";
  const at = new Date(life.purgesAt);
  // Past the window: the next scheduled purge takes it.
  if (at.getTime() <= Date.now()) return "Purge due";
  return `Purges on ${createdLabel.format(at)}`;
}

/** Copy for the one confirm drawer every lifecycle action shares. */
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

function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return createdLabel.format(date);
}

function notifyLabel(raw: string) {
  const value = raw.trim();
  if (!value || value === "pending") return "None";
  return value;
}

function packLabel(b: AdminBusiness) {
  if (!b.package_name) return "None";
  return b.package_period === "year" ? `${b.package_name} / year` : b.package_name;
}

function planLabel(b: AdminBusiness) {
  return b.billing_enforcement === "off" ? "Beta" : "On-demand";
}

function planOf(b: AdminBusiness): PlanChoice {
  return b.billing_enforcement === "off" ? "beta" : "on";
}

function chargeKind(kind: string) {
  if (kind === "call_charge") return "Call";
  if (kind === "line_rental") return "Line";
  if (kind === "admin_adjustment") return "Adjust";
  return kind.replaceAll("_", " ");
}

function chargeAmount(amount: number) {
  const abs = Math.abs(amount).toLocaleString("en-KE");
  return amount < 0 ? `-KES ${abs}` : `KES ${abs}`;
}

function phoneLine(b: AdminBusiness) {
  if (b.status === "waiting") return "Waiting";
  const number = b.sautikit_virtual_number.trim();
  if (number.startsWith("pending:")) return "None";
  return number;
}

function hasLiveNumber(b: AdminBusiness) {
  const number = b.sautikit_virtual_number.trim();
  return Boolean(number) && !number.startsWith("pending:");
}

/** Release is refused while the business is active. Same rule as the server. */
function releaseReason(b: AdminBusiness) {
  return releaseBlockReason({ linked: true, businessName: b.business_name, isActive: b.is_active });
}

function previewLine(b: AdminBusiness) {
  if (b.status === "archived") return purgeLabel(b);
  if (b.status === "suspended") return SUSPENDED_LINE;
  const pack = packLabel(b);
  if (b.status === "waiting") return pack === "None" ? "Waiting" : pack;
  return pack === "None" ? phoneLine(b) : `${phoneLine(b)} · ${pack}`;
}

function SheetNote({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p className="pb-3 text-body text-attention" role="alert">
      {error}
    </p>
  );
}

export function AdminBusinessesPanel({
  businesses,
  pendingBusinesses,
  availableDids,
  badges = {},
}: {
  businesses: AdminBusiness[];
  pendingBusinesses: PendingTenant[];
  availableDids: { e164: string }[];
  badges?: Record<string, QualityBadge>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShopFilter>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState<{ kind: SheetKind; id: string } | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleAction>("suspend");
  const [reason, setReason] = useState("");
  const [resumeBilling, setResumeBilling] = useState(false);
  const [plan, setPlan] = useState<PlanChoice>("beta");
  const [charges, setCharges] = useState<WalletLedgerRow[]>([]);
  const [packs, setPacks] = useState<PackOption[]>([]);
  const [packageId, setPackageId] = useState("");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [recordingMode, setRecordingMode] = useState<TenantRetentionMode>("default");
  const [recordingDays, setRecordingDays] = useState("30");

  const PAGE_SIZE = 25;
  const freeCount = availableDids.length;
  const byId = useMemo(() => new Map(businesses.map((row) => [row.id, row])), [businesses]);
  const open = sheet ? byId.get(sheet.id) || null : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return businesses.filter((b) => {
      if (filter === "all" ? b.status === "archived" : b.status !== filter) return false;
      if (!q) return true;
      return (
        b.business_name.toLowerCase().includes(q) ||
        b.sautikit_virtual_number.toLowerCase().includes(q) ||
        b.whatsapp_notification_number.toLowerCase().includes(q) ||
        (b.package_name || "").toLowerCase().includes(q)
      );
    });
  }, [businesses, filter, query]);

  const waiting = businesses.filter((b) => b.status === "waiting");
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const id = hash.startsWith("biz-") ? hash.slice(4) : "";
    if (id && byId.has(id)) setSheet({ kind: "shop", id });
  }, [byId]);

  async function run(
    body: Record<string, unknown>,
    url = "/api/admin/businesses",
    next: "shop" | "close" = "shop",
  ) {
    const shopId = sheet?.id;
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
    setSheet(next === "shop" && shopId ? { kind: "shop", id: shopId } : null);
    setStatus("Saved.");
    startTransition(() => router.refresh());
    return true;
  }

  async function loadPacks() {
    try {
      const res = await fetch("/api/admin/packages");
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        packages?: PackOption[];
      };
      if (!res.ok) throw new Error(json.error || "Could not load.");
      const next = (json.packages || []).filter((pack) => pack.isActive !== false);
      setPacks(next);
      if (!packageId && next[0]) setPackageId(next[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }

  function openKind(kind: SheetKind, id: string) {
    setError("");
    setSheet({ kind, id });
  }

  async function loadCharges(id: string) {
    setCharges([]);
    try {
      const res = await fetch(`/api/admin/wallets?ledger_for=${encodeURIComponent(id)}`);
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ledger?: WalletLedgerRow[];
      };
      if (!res.ok) throw new Error(json.error || "Could not load.");
      setCharges(json.ledger || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }

  function openLifecycle(action: LifecycleAction, id: string) {
    setLifecycle(action);
    setReason("");
    setResumeBilling(false);
    openKind("lifecycle", id);
  }

  function openShop(id: string) {
    openKind("shop", id);
  }

  function openAssign(id: string) {
    openKind("assign", id);
  }

  const emptyTitle = businesses.length === 0 ? "No businesses." : "No match.";
  const emptyLine =
    businesses.length === 0 ? "A business shows up here after signup." : "Try another name or number.";

  return (
    <>
      {pendingBusinesses.length > 0 ? (
        <section>
          <p className="px-4 text-caption text-ink-3">Needs you</p>
          {freeCount === 0 ? (
            <div className="px-4 py-3">
              <Empty
                className="px-0 py-8"
                title="No numbers available"
                line={pendingBusinesses.length === 1 ? "1 waiting" : `${pendingBusinesses.length} waiting`}
                action={<ButtonLink href="/admin/numbers">Add number</ButtonLink>}
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {pendingBusinesses.map((row) => {
                const b = byId.get(row.id);
                const name = b?.business_name || row.business_name;
                return (
                  <ListRow
                    key={row.id}
                    title={name}
                    preview="Waiting"
                    unread
                    onOpen={() => openShop(row.id)}
                    actions={
                      freeCount > 0 ? (
                        <Button type="button" variant="tonal" size="sm" onClick={() => openAssign(row.id)}>
                          Assign
                        </Button>
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <p className="px-4 text-caption text-ink-3">Businesses</p>
        <div className="px-4 py-2">
          <Input
            id="biz-search"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search"
            aria-label="Search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Segmented
          label="Businesses filter"
          items={[
            {
              key: "all",
              label: "All",
              count: businesses.filter((b) => b.status !== "archived").length,
              active: filter === "all",
            },
            { key: "waiting", label: "Waiting", count: waiting.length, active: filter === "waiting" },
            {
              key: "active",
              label: "Active",
              count: businesses.filter((b) => b.status === "active").length,
              active: filter === "active",
            },
            {
              key: "suspended",
              label: "Suspended",
              count: businesses.filter((b) => b.status === "suspended").length,
              active: filter === "suspended",
            },
            {
              key: "archived",
              label: "Archived",
              count: businesses.filter((b) => b.status === "archived").length,
              active: filter === "archived",
            },
          ]}
          onSelect={(key) => {
            setFilter(key as ShopFilter);
            setPage(1);
          }}
        />
        {error ? (
          <p className="px-4 text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="px-4 text-body text-ok" role="status">
            {status}
          </p>
        ) : null}
        {pageRows.length === 0 ? (
          <Empty title={emptyTitle} line={emptyLine} />
        ) : (
          <ul className="divide-y divide-hairline">
            {pageRows.map((b) => {
              const badge = badges[b.id];
              return (
                <ListRow
                  key={b.id}
                  id={`biz-${b.id}`}
                  title={b.business_name}
                  preview={badge?.dropping ? `${previewLine(b)} · ${badge.droppingReason}` : previewLine(b)}
                  when={badge && badge.score != null ? formatScore(badge.score) : undefined}
                  stamp={
                    <span className="inline-flex items-center gap-2">
                      {badge?.dropping ? <Stamp tone="attention">Dropping</Stamp> : null}
                      <Stamp tone={statusTone(b.status)}>{statusLabel(b.status)}</Stamp>
                    </span>
                  }
                  onOpen={() => openShop(b.id)}
                />
              );
            })}
          </ul>
        )}
        {filtered.length > PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 text-meta tabular-nums text-ink-2">
              {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <Sheet
        open={sheet?.kind === "shop"}
        onOpenChange={(next) => {
          if (!next) setSheet(null);
        }}
        title={open?.business_name || "Business"}
        theme="admin"
      >
        <SheetNote error={error} />
        {open ? (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {open.status === "suspended" ? (
              <ListRow title="Status" preview={SUSPENDED_LINE} stamp={<Stamp tone="attention">Suspended</Stamp>} />
            ) : null}
            {open.status === "archived" ? (
              <ListRow title="Status" preview={purgeLabel(open)} stamp={<Stamp tone="neutral">Archived</Stamp>} />
            ) : null}
            <ListRow title="Number" preview={phoneLine(open)} />
            {badges[open.id] ? (
              <ListRow
                title="Quality"
                href={`/admin/quality/${open.id}`}
                preview={
                  badges[open.id]?.dropping
                    ? badges[open.id]?.droppingReason
                    : formatScore(badges[open.id]?.score ?? null)
                }
                stamp={
                  badges[open.id]?.dropping ? (
                    <Stamp tone="attention">Dropping</Stamp>
                  ) : (
                    <Stamp tone="neutral">{formatScore(badges[open.id]?.score ?? null)}</Stamp>
                  )
                }
              />
            ) : null}
            <ListRow title="Notify" preview={notifyLabel(open.whatsapp_notification_number)} />
            <ListRow title="Created" preview={formatCreated(open.created_at)} />
            <ListRow
              title="Activity"
              href={`/admin/activity?business=${open.id}`}
              preview="Who changed what, and when"
            />
            <ListRow
              title="Package"
              preview={packLabel(open)}
              onOpen={() => {
                setPeriod(open.package_period || "month");
                openKind("package", open.id);
                void loadPacks();
              }}
            />
            <ListRow
              title="Plan"
              preview={planLabel(open)}
              onOpen={() => {
                setPlan(planOf(open));
                openKind("plan", open.id);
              }}
            />
            <ListRow
              title="Charges"
              preview="Calls and line fees"
              onOpen={() => {
                openKind("charges", open.id);
                void loadCharges(open.id);
              }}
            />
            <ListRow
              title="Recording retention"
              preview={tenantRetentionLabel(open.recording_retention_days_override)}
              onOpen={() => {
                const init = tenantRetentionInit(open.recording_retention_days_override);
                setRecordingMode(init.mode);
                setRecordingDays(init.days);
                openKind("recording", open.id);
              }}
            />
            {open.status === "waiting" ? (
              <ListRow
                title="Assign"
                preview={freeCount > 0 ? "Pick a number" : "Add a number"}
                onOpen={() => (freeCount > 0 ? openAssign(open.id) : undefined)}
                href={freeCount > 0 ? undefined : "/admin/numbers"}
              />
            ) : null}
            {hasLiveNumber(open) ? (
              releaseReason(open) ? (
                <ListRow
                  title="Release number"
                  preview={
                    <span id={`release-why-${open.id}`} title={releaseReason(open) || undefined}>
                      Live. Archive the business first.
                    </span>
                  }
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled
                      aria-describedby={`release-why-${open.id}`}
                    >
                      Release
                    </Button>
                  }
                />
              ) : (
                <ListRow
                  title="Release number"
                  preview={open.sautikit_virtual_number}
                  onOpen={() => openKind("release", open.id)}
                />
              )
            ) : null}
            {(() => {
              const life = lifecycleOf(open);
              if (life.state === "archived") {
                return (
                  <ListRow
                    title="Unarchive"
                    preview={life.purgesAt ? `Until ${createdLabel.format(new Date(life.purgesAt))}` : "Back on the list"}
                    onOpen={() => openLifecycle("restore", open.id)}
                  />
                );
              }
              return (
                <>
                  {life.state === "suspended" ? (
                    life.byAdmin ? (
                      <ListRow
                        title="Restore line"
                        preview="Start taking calls again"
                        onOpen={() => openLifecycle("unsuspend", open.id)}
                      />
                    ) : (
                      <ListRow title="Restore line" preview="Suspended for non-payment. Comes back when paid." />
                    )
                  ) : (
                    <ListRow
                      title="Suspend"
                      preview="Pause calls. Data and billing stay."
                      onOpen={() => openLifecycle("suspend", open.id)}
                    />
                  )}
                  <ListRow
                    title="Archive"
                    preview={`Close and hide. Unarchive within ${ARCHIVE_RESTORE_DAYS} days.`}
                    onOpen={() => openLifecycle("archive", open.id)}
                  />
                </>
              );
            })()}
          </ul>
        ) : null}
      </Sheet>

      <Sheet
        open={sheet?.kind === "assign"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title={open?.business_name || "Assign"}
        theme="admin"
        footer={
          freeCount > 0 ? (
            <Button
              type="button"
              block
              pending={pending}
              onClick={() => open && void run({ action: "assign_next", business_id: open.id })}
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
                  open &&
                  void run(
                    { action: "assign_specific", tenant_id: open.id, e164: row.e164 },
                    "/api/did-pool",
                  )
                }
              />
            ))}
          </ul>
        )}
      </Sheet>

      <ConfirmSheet
        open={sheet?.kind === "release"}
        theme="admin"
        title="Release this number?"
        confirmLabel="Release"
        danger
        pending={pending}
        onClose={() => setSheet(open ? { kind: "shop", id: open.id } : null)}
        onConfirm={() => open && void run({ action: "release_did", business_id: open.id })}
      >
        <SheetNote error={error} />
        <p>
          {open
            ? `${open.sautikit_virtual_number} returns to Available. ${open.business_name} waits for a new number.`
            : ""}
        </p>
      </ConfirmSheet>

      <Sheet
        open={sheet?.kind === "plan"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title="Plan"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={pending}
            onClick={() =>
              open &&
              void run(
                {
                  action: "set_billing_mode",
                  business_id: open.id,
                  mode: plan === "on" ? "soft" : "off",
                  note: plan === "on" ? "On-demand" : "Beta",
                },
                "/api/admin/wallets",
              )
            }
          >
            Save
          </Button>
        }
      >
        <SheetNote error={error} />
        <p className="pb-3 text-body text-ink-2">
          {plan === "on"
            ? "Past included uses the rate card when the shop opted in."
            : "Meter only. Not charged."}
        </p>
        <Segmented
          className="-mx-5 px-5 sm:-mx-6 sm:px-6"
          label="Plan"
          items={[
            { key: "beta", label: "Beta", active: plan === "beta" },
            { key: "on", label: "On-demand", active: plan === "on" },
          ]}
          onSelect={(key) => setPlan(key as PlanChoice)}
        />
      </Sheet>

      <Sheet
        open={sheet?.kind === "charges"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title="Charges"
        theme="admin"
      >
        <SheetNote error={error} />
        {charges.length === 0 ? (
          <Empty className="px-0 py-8" title="No charges." line="On-demand lines show up here." />
        ) : (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {charges.map((row) => (
              <ListRow
                key={row.id}
                title={chargeKind(row.kind)}
                preview={row.note || chargeAmount(row.amount_kes)}
                when={formatCreated(row.created_at)}
              />
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet
        open={sheet?.kind === "package"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title="Package"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={pending}
            disabled={!packageId}
            onClick={() =>
              open &&
              void run(
                { action: "assign", business_id: open.id, package_id: packageId, period },
                "/api/admin/packages",
              )
            }
          >
            Assign
          </Button>
        }
      >
        <SheetNote error={error} />
        <Segmented
          className="-mx-5 px-5 sm:-mx-6 sm:px-6 md:-mx-6 md:px-6"
          label="Period"
          items={[
            { key: "month", label: "Month", active: period === "month" },
            { key: "year", label: "Year", active: period === "year" },
          ]}
          onSelect={(key) => setPeriod(key as "month" | "year")}
        />
        {packs.length === 0 ? (
          <Empty
            className="px-0 py-8"
            title="No packages."
            line="Set SKUs on Packages."
            action={<ButtonLink href="/admin/packages">Packages</ButtonLink>}
          />
        ) : (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {packs.map((pack) => (
              <ListRow
                key={pack.id}
                title={pack.name}
                unread={pack.id === packageId}
                onOpen={() => setPackageId(pack.id)}
              />
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet
        open={sheet?.kind === "recording"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title="Recording retention"
        theme="admin"
        footer={
          <Button
            type="button"
            block
            pending={pending}
            onClick={() =>
              open &&
              void run({
                action: "save_recording_retention",
                business_id: open.id,
                before_override: open.recording_retention_days_override,
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

      <ConfirmSheet
        open={sheet?.kind === "lifecycle"}
        theme="admin"
        title={LIFECYCLE[lifecycle].title}
        confirmLabel={LIFECYCLE[lifecycle].confirm}
        danger={LIFECYCLE[lifecycle].danger}
        pending={pending}
        confirmDisabled={!reasonOk(reason)}
        onClose={() => {
          setReason("");
          setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        onConfirm={() =>
          open &&
          void run({
            action: lifecycle,
            business_id: open.id,
            reason: reason.trim(),
            ...(lifecycle === "restore" ? { resume_billing: resumeBilling } : {}),
          })
        }
      >
        <SheetNote error={error} />
        <p className="pb-3">{open ? LIFECYCLE[lifecycle].body(open) : ""}</p>
        {lifecycle === "restore" && open ? (
          <RestoreBillingChoice
            offer={resumeBillingOffer(open.pre_archive)}
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
    </>
  );
}

/** Unarchive: explicit "back on as before" choice, off by default. */
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
    <div data-restore-billing="" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2">
      <div className="min-w-0">
        <p className="text-body font-medium text-ink">{offer.label}</p>
        <p className="text-meta text-ink-2">{offer.summary}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={offer.label} />
    </div>
  );
}

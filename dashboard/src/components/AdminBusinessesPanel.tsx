"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { PendingTenant } from "@/lib/didPool";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp, type StampTone } from "@/components/ui/Stamp";

const createdLabel = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});

type ShopFilter = "all" | "waiting" | "active" | "archived";
type SheetKind = "shop" | "assign" | "release" | "ledger" | "remove" | "package";
type PackOption = { id: string; name: string; isActive?: boolean };

function statusLabel(status: AdminBusiness["status"]) {
  if (status === "waiting") return "Waiting";
  if (status === "archived") return "Archived";
  return "Active";
}

function statusTone(status: AdminBusiness["status"]): StampTone {
  if (status === "waiting") return "attention";
  if (status === "active") return "ok";
  return "neutral";
}

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

function moneyKes(b: AdminBusiness) {
  const kes = Number(b.wallet_balance_kes ?? b.telecom_wallet_balance_kes ?? 0);
  return `KES ${kes.toLocaleString("en-KE")}`;
}

function phoneLine(b: AdminBusiness) {
  return b.status === "waiting" ? "Waiting" : b.sautikit_virtual_number;
}

export function AdminBusinessesPanel({
  businesses,
  pendingBusinesses,
  availableDids,
}: {
  businesses: AdminBusiness[];
  pendingBusinesses: PendingTenant[];
  availableDids: { e164: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShopFilter>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState<{ kind: SheetKind; id: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deltaKes, setDeltaKes] = useState("1000");
  const [adjustNote, setAdjustNote] = useState("Ops credit");
  const [packs, setPacks] = useState<PackOption[]>([]);
  const [packageId, setPackageId] = useState("");
  const [period, setPeriod] = useState<"month" | "year">("month");

  const PAGE_SIZE = 25;
  const freeCount = availableDids.length;
  const byId = useMemo(() => new Map(businesses.map((row) => [row.id, row])), [businesses]);
  const open = sheet ? byId.get(sheet.id) || null : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return businesses.filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
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
    setSheet(null);
    setConfirmText("");
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

  function openShop(id: string) {
    setSheet({ kind: "shop", id });
  }

  function openAssign(id: string) {
    setSheet({ kind: "assign", id });
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
          <Field id="biz-search" label="Search">
            {(props) => (
              <Input
                {...props}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
        </div>
        <Segmented
          label="Businesses filter"
          items={[
            { key: "all", label: "All", count: businesses.length, active: filter === "all" },
            { key: "waiting", label: "Waiting", count: waiting.length, active: filter === "waiting" },
            {
              key: "active",
              label: "Active",
              count: businesses.filter((b) => b.status === "active").length,
              active: filter === "active",
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
            {pageRows.map((b) => (
              <ListRow
                key={b.id}
                id={`biz-${b.id}`}
                title={b.business_name}
                preview={b.status === "waiting" ? packLabel(b) : `${phoneLine(b)} · ${packLabel(b)}`}
                when={moneyKes(b)}
                stamp={<Stamp tone={statusTone(b.status)}>{statusLabel(b.status)}</Stamp>}
                onOpen={() => openShop(b.id)}
                actions={
                  b.status === "waiting" && freeCount > 0 ? (
                    <Button type="button" variant="tonal" size="sm" onClick={() => openAssign(b.id)}>
                      Assign
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
        {filtered.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-meta tabular-nums text-ink-2">
              {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
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
        description={open ? formatCreated(open.created_at) : undefined}
        theme="admin"
      >
        {open ? (
          <ul className="divide-y divide-hairline">
            <ListRow title="Number" preview={phoneLine(open)} />
            <ListRow title="Notify" preview={notifyLabel(open.whatsapp_notification_number)} />
            <ListRow title="Created" preview={formatCreated(open.created_at)} />
            <ListRow
              title="Package"
              preview={packLabel(open)}
              onOpen={() => {
                setPeriod(open.package_period || "month");
                setSheet({ kind: "package", id: open.id });
                void loadPacks();
              }}
            />
            <ListRow
              title="Ledger"
              preview={moneyKes(open)}
              onOpen={() => {
                setDeltaKes("1000");
                setAdjustNote("Ops credit");
                setSheet({ kind: "ledger", id: open.id });
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
            {open.status === "active" ? (
              <ListRow title="Release" preview={open.sautikit_virtual_number} onOpen={() => setSheet({ kind: "release", id: open.id })} />
            ) : null}
            <ListRow title="Remove" preview="Frees the number" onOpen={() => setSheet({ kind: "remove", id: open.id })} />
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
              pending={pending}
              onClick={() => open && void run({ action: "assign_next", business_id: open.id })}
            >
              Assign next available
            </Button>
          ) : (
            <ButtonLink href="/admin/numbers">Add number</ButtonLink>
          )
        }
      >
        {freeCount === 0 ? (
          <Empty className="px-0 py-8" title="No numbers available" line="Add a number, then assign." />
        ) : (
          <ul className="divide-y divide-hairline">
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

      <Sheet
        open={sheet?.kind === "release"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title="Release this number?"
        description={
          open
            ? `${open.sautikit_virtual_number} returns to Available. ${open.business_name} waits.`
            : undefined
        }
        theme="admin"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => open && setSheet({ kind: "shop", id: open.id })}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              pending={pending}
              onClick={() => open && void run({ action: "release_did", business_id: open.id })}
            >
              Release
            </Button>
          </>
        }
      >
        <p className="text-body text-ink-2">The number stays in the pool as Available.</p>
      </Sheet>

      <Sheet
        open={sheet?.kind === "ledger"}
        onOpenChange={(next) => {
          if (!next) setSheet(open ? { kind: "shop", id: open.id } : null);
        }}
        title="Adjust ledger"
        theme="admin"
        footer={
          <Button
            type="button"
            pending={pending}
            onClick={() =>
              open &&
              void run({
                action: "adjust_wallet",
                business_id: open.id,
                delta_kes: Number(deltaKes) || 0,
                note: adjustNote,
              })
            }
          >
            Apply
          </Button>
        }
      >
        <div className="space-y-3">
          <Field id="biz-delta" label="Amount" hint="KES. Plus credits, minus debits.">
            {(props) => (
              <Input
                {...props}
                className="tabular-nums"
                value={deltaKes}
                onChange={(event) => setDeltaKes(event.target.value)}
              />
            )}
          </Field>
          <Field id="biz-note" label="Note">
            {(props) => (
              <Input {...props} value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} />
            )}
          </Field>
        </div>
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
        <Segmented
          label="Period"
          items={[
            { key: "month", label: "Month", active: period === "month" },
            { key: "year", label: "Year", active: period === "year" },
          ]}
          onSelect={(key) => setPeriod(key as "month" | "year")}
        />
        {packs.length === 0 ? (
          <Empty className="px-0 py-8" title="No packages." line="Set SKUs on Packages." />
        ) : (
          <ul className="divide-y divide-hairline">
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
        open={sheet?.kind === "remove"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmText("");
            setSheet(open ? { kind: "shop", id: open.id } : null);
          }
        }}
        title="Remove this business?"
        description="Frees the number and deletes its calls. Type REMOVE."
        theme="admin"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirmText("");
                if (open) setSheet({ kind: "shop", id: open.id });
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              pending={pending}
              disabled={confirmText !== "REMOVE"}
              onClick={() => open && void run({ action: "remove", business_id: open.id })}
            >
              Remove
            </Button>
          </>
        }
      >
        <Field id="biz-remove" label="Confirm">
          {(props) => (
            <Input {...props} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
          )}
        </Field>
      </Sheet>
    </>
  );
}

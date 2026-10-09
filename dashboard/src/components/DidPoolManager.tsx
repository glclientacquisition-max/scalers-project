"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { BuyNumberPanel } from "@/components/BuyNumberPanel";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp, type StampTone } from "@/components/ui/Stamp";
import { releaseBlockReason } from "@/lib/adminBusinessModel";
import type { DidPoolRow, PendingTenant } from "@/lib/didPool";

type PoolFilter = "all" | "available" | "assigned";

function waitingPreview(count: number) {
  return count === 1 ? "1 waiting" : `${count} waiting`;
}

function statusTone(status: string): StampTone {
  if (status === "available") return "ok";
  if (status === "disabled" || status === "reserved") return "attention";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "available") return "Available";
  if (status === "assigned") return "Assigned";
  if (status === "disabled") return "Disabled";
  if (status === "reserved") return "Reserved";
  return status;
}

function businessLabel(row: DidPoolRow) {
  if (row.tenants?.business_name) return row.tenants.business_name;
  if (row.tenant_id) return "Linked business";
  if (row.status === "assigned" || row.status === "reserved") return "Not linked";
  return "";
}

function canRelease(status: string) {
  return status === "assigned" || status === "reserved";
}

/** Same rule as the server: a number live on an active business can't be released. */
function releaseReason(row: DidPoolRow) {
  return releaseBlockReason({
    linked: Boolean(row.tenant_id && row.tenants),
    businessName: row.tenants?.business_name,
    isActive: row.tenants?.is_active,
  });
}

export function DidPoolManager({
  pool,
  pendingBusinesses,
}: {
  pool: DidPoolRow[];
  pendingBusinesses: PendingTenant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<PoolFilter>("all");
  const [sheet, setSheet] = useState<"add" | "buy" | "assign" | "release" | null>(null);
  const [e164, setE164] = useState("");
  const [notes, setNotes] = useState("");
  const [assignBusiness, setAssignBusiness] = useState<PendingTenant | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<DidPoolRow | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const availableRows = pool.filter((row) => row.status === "available");
  const assignedCount = pool.filter((row) => row.status === "assigned").length;
  const visible = useMemo(() => {
    if (filter === "available") return pool.filter((row) => row.status === "available");
    if (filter === "assigned") return pool.filter((row) => row.status === "assigned" || row.status === "reserved");
    return pool;
  }, [filter, pool]);

  async function run(body: Record<string, unknown>) {
    setError("");
    setStatus("");
    const res = await fetch("/api/did-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      e164?: string;
      row?: { e164?: string };
    };
    if (!res.ok) {
      setError(json.error || "Could not save.");
      return null;
    }
    startTransition(() => router.refresh());
    return json;
  }

  async function addNumber() {
    const json = await run({ action: "add", e164, notes });
    if (!json) return;
    setStatus(`Added ${json.row?.e164 || e164}.`);
    setE164("");
    setNotes("");
    setSheet(null);
  }

  async function assignNumber(pick: "next" | string) {
    if (!assignBusiness) return;
    const body =
      pick === "next"
        ? { action: "assign_next", tenant_id: assignBusiness.id }
        : { action: "assign_specific", tenant_id: assignBusiness.id, e164: pick };
    const json = await run(body);
    if (!json) return;
    setStatus(`Assigned ${json.e164 || pick}.`);
    setAssignBusiness(null);
    setSheet(null);
  }

  async function confirmRelease() {
    if (!releaseTarget) return;
    const target = releaseTarget;
    const json = await run({ action: "release", e164: target.e164 });
    if (!json) return;
    setReleaseTarget(null);
    setSheet(null);
    setStatus(`${target.e164} is Available.`);
  }

  async function syncPool() {
    setSyncBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/admin/sautikit-sync", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        added?: string[];
        linked?: string[];
      };
      if (!res.ok) throw new Error(json.error || "Could not sync.");
      const added = json.added?.length || 0;
      const linked = json.linked?.length || 0;
      setStatus(added || linked ? `Synced. ${added} added.` : "Already in sync.");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync.");
    } finally {
      setSyncBusy(false);
    }
  }

  function openAssign(business: PendingTenant) {
    setAssignBusiness(business);
    setSheet("assign");
  }

  const releaseBusiness = releaseTarget ? businessLabel(releaseTarget) : "";
  const releaseLinked = Boolean(releaseBusiness);

  return (
    <>
      {pendingBusinesses.length > 0 ? (
        <section>
          <p className="px-4 text-caption text-ink-3">Needs you</p>
          <ul className="divide-y divide-hairline">
            {pendingBusinesses.map((business) => (
              <ListRow
                key={business.id}
                title={business.business_name}
                preview="Waiting"
                unread
                actions={
                  <Button type="button" variant="tonal" size="sm" onClick={() => openAssign(business)}>
                    Assign
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="px-4 text-caption text-ink-3">Pool</p>
        <Segmented
          label="Pool filter"
          items={[
            { key: "all", label: "All", count: pool.length, active: filter === "all" },
            { key: "available", label: "Available", count: availableRows.length, active: filter === "available" },
            { key: "assigned", label: "Assigned", count: assignedCount, active: filter === "assigned" },
          ]}
          onSelect={(key) => setFilter(key as PoolFilter)}
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
        {visible.length === 0 ? (
          <Empty
            title="No numbers."
            line={pendingBusinesses.length ? waitingPreview(pendingBusinesses.length) : "Add a number."}
            action={
              <Button type="button" variant="tonal" onClick={() => setSheet("add")}>
                Add number
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {visible.map((row) => (
              <ListRow
                key={row.id}
                title={row.e164}
                preview={
                  canRelease(row.status) && releaseReason(row)
                    ? `Live on ${businessLabel(row)} · archive to release`
                    : businessLabel(row) || row.notes || undefined
                }
                stamp={<Stamp tone={statusTone(row.status)}>{statusLabel(row.status)}</Stamp>}
                actions={
                  canRelease(row.status) ? (
                    releaseReason(row) ? (
                      <>
                        <span id={`release-why-${row.id}`} className="sr-only">
                          {releaseReason(row)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled
                          title={releaseReason(row) || undefined}
                          aria-describedby={`release-why-${row.id}`}
                        >
                          Release
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReleaseTarget(row);
                          setSheet("release");
                        }}
                      >
                        Release
                      </Button>
                    )
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
        <ul className="divide-y divide-hairline">
          <ListRow
            title="Add number"
            onOpen={() => setSheet("add")}
            when={<ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />}
          />
          <ListRow
            title="Buy"
            onOpen={() => setSheet("buy")}
            when={<ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />}
          />
          <ListRow
            title="Sync"
            preview={syncBusy ? "Working" : undefined}
            onOpen={() => void syncPool()}
          />
        </ul>
      </section>

      <Sheet
        open={sheet === "add"}
        onOpenChange={(open) => setSheet(open ? "add" : null)}
        title="Add number"
        theme="admin"
        footer={
          <Button type="button" pending={pending} disabled={!e164.trim()} onClick={() => void addNumber()}>
            Add
          </Button>
        }
      >
        <div className="space-y-3">
          <Field id="add-did-e164" label="Phone" hint="Kenya mobile">
            {(props) => (
              <Input
                {...props}
                value={e164}
                onChange={(event) => setE164(event.target.value)}
                inputMode="tel"
                autoComplete="off"
              />
            )}
          </Field>
          <Field id="add-did-notes" label="Notes">
            {(props) => (
              <Input {...props} value={notes} onChange={(event) => setNotes(event.target.value)} />
            )}
          </Field>
        </div>
      </Sheet>

      <BuyNumberPanel
        open={sheet === "buy"}
        onOpenChange={(open) => setSheet(open ? "buy" : null)}
        onBought={(number) => {
          setStatus(`Bought ${number}.`);
          setSheet(null);
          startTransition(() => router.refresh());
        }}
      />

      <Sheet
        open={sheet === "assign"}
        onOpenChange={(open) => {
          if (!open) {
            setAssignBusiness(null);
            setSheet(null);
          }
        }}
        title={assignBusiness?.business_name || "Assign"}
        theme="admin"
        footer={
          availableRows.length > 0 ? (
            <Button type="button" pending={pending} onClick={() => void assignNumber("next")}>
              Assign next available
            </Button>
          ) : (
            <Button type="button" variant="tonal" onClick={() => setSheet("add")}>
              Add number
            </Button>
          )
        }
      >
        {availableRows.length === 0 ? (
          <Empty className="px-0 py-8" title="No numbers available" line={waitingPreview(pendingBusinesses.length)} />
        ) : (
          <ul className="divide-y divide-hairline">
            {availableRows.map((row) => (
              <ListRow
                key={row.id}
                title={row.e164}
                preview={row.notes || undefined}
                onOpen={() => void assignNumber(row.e164)}
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
        onClose={() => {
          setReleaseTarget(null);
          setSheet(null);
        }}
        onConfirm={() => void confirmRelease()}
      >
        {error ? (
          <p className="pb-3 text-attention" role="alert">
            {error}
          </p>
        ) : null}
        <p>
          {releaseTarget
            ? releaseLinked
              ? `${releaseTarget.e164} returns to Available. ${releaseBusiness} waits for a new number.`
              : `${releaseTarget.e164} returns to Available.`
            : ""}
        </p>
      </ConfirmSheet>
    </>
  );
}

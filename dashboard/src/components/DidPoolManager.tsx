"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminRowMutedClass, adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import { Button } from "@/components/ui/Button";
import { btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp, type StampTone } from "@/components/ui/Stamp";
import type { DidPoolRow, PendingTenant } from "@/lib/didPool";

const ADD_FIELD_ID = "add-did-e164";

function focusAddNumber() {
  document.getElementById(ADD_FIELD_ID)?.focus();
}

function waitingLine(count: number) {
  if (count === 1) return "1 business is waiting.";
  return `${count} businesses are waiting.`;
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
  return "None";
}

function canRelease(status: string) {
  return status === "assigned" || status === "reserved";
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
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [e164, setE164] = useState("");
  const [notes, setNotes] = useState("");
  const [assignBusinessId, setAssignBusinessId] = useState(pendingBusinesses[0]?.id || "");
  const [pickE164, setPickE164] = useState("next");
  const [releaseTarget, setReleaseTarget] = useState<DidPoolRow | null>(null);

  const availableRows = pool.filter((row) => row.status === "available");
  const available = availableRows.length;

  async function run(body: Record<string, unknown>) {
    setError(null);
    setStatus(null);
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
      setError(json.error || "Request failed");
      return null;
    }
    startTransition(() => router.refresh());
    return json;
  }

  async function addNumber() {
    const json = await run({ action: "add", e164, notes });
    if (!json) return;
    const added = json.row?.e164 || e164;
    setStatus(`Added ${added}. It is Available.`);
    setE164("");
    setNotes("");
  }

  async function assignNumber() {
    const body =
      pickE164 === "next"
        ? { action: "assign_next", tenant_id: assignBusinessId }
        : { action: "assign_specific", tenant_id: assignBusinessId, e164: pickE164 };
    const json = await run(body);
    if (!json) return;
    setStatus(`Assigned ${json.e164 || pickE164}.`);
    setPickE164("next");
  }

  async function confirmRelease() {
    if (!releaseTarget) return;
    const target = releaseTarget;
    const json = await run({ action: "release", e164: target.e164 });
    if (!json) return;
    setReleaseTarget(null);
    setStatus(`${target.e164} is Available.`);
  }

  const releaseBusiness = releaseTarget ? businessLabel(releaseTarget) : null;
  const releaseLinked = releaseBusiness && releaseBusiness !== "None" && releaseBusiness !== "Not linked";

  return (
    <div className="space-y-6">
      <div className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Add number to pool</h2>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void addNumber();
          }}
        >
          <Field id={ADD_FIELD_ID} label="Phone number (E.164)" required className="flex-1">
            {(props) => (
              <Input
                {...props}
                value={e164}
                onChange={(event) => setE164(event.target.value)}
                placeholder="+2547…"
                autoComplete="off"
                inputMode="tel"
              />
            )}
          </Field>
          <Field id="add-did-notes" label="Notes" className="flex-1">
            {(props) => (
              <Input
                {...props}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
              />
            )}
          </Field>
          <button type="submit" disabled={pending || !e164.trim()} className={btnPrimary}>
            Add to pool
          </button>
        </form>
      </div>

      <div className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">Assign to a business</h2>
        {pendingBusinesses.length === 0 ? (
          <p className="mt-2 text-body text-ink-2">No businesses are waiting for a number.</p>
        ) : available === 0 ? (
          <Empty
            className="px-0 py-8"
            title="No numbers available"
            line={waitingLine(pendingBusinesses.length)}
            action={
              <Button type="button" variant="tonal" onClick={focusAddNumber}>
                Add number
              </Button>
            }
          />
        ) : (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void assignNumber();
            }}
          >
            <div className="block min-w-0 flex-1 text-sm">
              <span className="font-medium text-ink">Business</span>
              <DeskSelect
                aria-label="Business"
                className={`mt-1 ${deskFieldClass}`}
                portalThemeClass="admin-theme"
                value={assignBusinessId}
                onChange={setAssignBusinessId}
                options={pendingBusinesses.map((business) => ({
                  value: business.id,
                  label: business.business_name,
                }))}
              />
            </div>
            <div className="block min-w-0 flex-1 text-sm">
              <span className="font-medium text-ink">Number</span>
              <DeskSelect
                aria-label="Number"
                className={`mt-1 ${deskFieldClass}`}
                portalThemeClass="admin-theme"
                value={pickE164}
                onChange={setPickE164}
                options={[
                  { value: "next", label: "Next available" },
                  ...availableRows.map((row) => ({ value: row.e164, label: row.e164 })),
                ]}
              />
            </div>
            <Button type="submit" variant="tonal" pending={pending} disabled={!assignBusinessId}>
              {pickE164 === "next" ? "Assign next available" : "Assign this number"}
            </Button>
          </form>
        )}
      </div>

      {error ? (
        <p className="text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-body text-ok" role="status">
          {status}
        </p>
      ) : null}

      <p className="text-meta text-ink-2">
        <span className="tabular-nums">{available}</span> available ·{" "}
        <span className="tabular-nums">{pool.filter((row) => row.status === "assigned").length}</span> assigned
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-ink-2">
            <tr className="border-b border-line/70">
              <th className={adminThClass}>Number</th>
              <th className={adminThClass}>Status</th>
              <th className={adminThClass}>Business</th>
              <th className={adminThClass}>Notes</th>
              <th className={adminThClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pool.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <Empty
                    title="Pool empty."
                    line="Added numbers show here as Available."
                    action={
                      <Button type="button" variant="tonal" onClick={focusAddNumber}>
                        Add number
                      </Button>
                    }
                  />
                </td>
              </tr>
            ) : (
              pool.map((row) => (
                <tr key={row.id} className="border-t border-line/70">
                  <td className={`${adminTdClass} font-medium tabular-nums`}>{row.e164}</td>
                  <td className={adminTdClass}>
                    <Stamp tone={statusTone(row.status)}>{statusLabel(row.status)}</Stamp>
                  </td>
                  <td className={adminTdClass}>{businessLabel(row)}</td>
                  <td className={`${adminTdClass} text-ink-2`}>{row.notes || "None"}</td>
                  <td className={adminTdClass}>
                    {canRelease(row.status) ? (
                      <button
                        type="button"
                        className={adminRowMutedClass}
                        disabled={pending}
                        onClick={() => setReleaseTarget(row)}
                      >
                        Release number
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet
        open={releaseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReleaseTarget(null);
        }}
        title="Release this number?"
        description={
          releaseTarget
            ? releaseLinked
              ? `${releaseTarget.e164} returns to Available. ${releaseBusiness} will wait for a number.`
              : `${releaseTarget.e164} returns to Available. No business is linked.`
            : undefined
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setReleaseTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" pending={pending} onClick={() => void confirmRelease()}>
              Release number
            </Button>
          </>
        }
      >
        {error ? (
          <p className="text-body text-attention" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-body text-ink-2">The pool row becomes Available.</p>
        )}
      </Sheet>
    </div>
  );
}

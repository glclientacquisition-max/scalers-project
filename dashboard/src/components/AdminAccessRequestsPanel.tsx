"use client";

import { useState, useTransition } from "react";
import {
  approveAccessRequestAction,
  declineAccessRequestAction,
} from "@/app/admin/(console)/access-requests/actions";

export type AccessRequestRow = {
  id: string;
  created_at: string;
  name: string;
  business: string;
  phone: string;
  email: string;
  about: string;
  status: "pending" | "approved" | "declined";
  decided_at: string | null;
  decided_by: string | null;
};

function statusStamp(status: AccessRequestRow["status"]) {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-900";
    case "approved":
      return "bg-emerald-100 text-emerald-900";
    case "declined":
      return "bg-surface-muted text-ink-soft";
    default:
      return "bg-surface-muted text-ink-soft";
  }
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function AdminAccessRequestsPanel({ rows }: { rows: AccessRequestRow[] }) {
  const [pending, startTransition] = useTransition();
  const [confirmDeclineId, setConfirmDeclineId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runApprove(id: string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await approveAccessRequestAction(id);
      if (result.error) setError(result.error);
      else setMessage("Invite sent.");
    });
  }

  function runDecline(id: string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await declineAccessRequestAction(id);
      setConfirmDeclineId(null);
      if (result.error) setError(result.error);
      else setMessage("Request declined.");
    });
  }

  if (!rows.length) {
    return (
      <p className="mt-6 rounded-panel border border-line bg-surface px-4 py-8 text-sm text-ink-soft">
        No access requests yet.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {message ? <p className="text-sm text-ok">{message}</p> : null}
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
        {rows.map((row) => (
          <li key={row.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{row.business}</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {row.name} · {row.email} · {row.phone}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink">{row.about}</p>
                <p className="mt-2 text-xs text-ink-soft">{formatWhen(row.created_at)}</p>
                {row.decided_at ? (
                  <p className="mt-1 text-xs text-ink-soft">
                    {row.status} {row.decided_by ? `by ${row.decided_by}` : ""} ·{" "}
                    {formatWhen(row.decided_at)}
                  </p>
                ) : null}
              </div>
              <span
                className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${statusStamp(row.status)}`}
              >
                {row.status}
              </span>
            </div>

            {row.status === "pending" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => runApprove(row.id)}
                  className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmDeclineId(row.id)}
                  className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:bg-surface-muted disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            ) : null}

            {confirmDeclineId === row.id ? (
              <div
                className="mt-4 rounded-xl border border-line bg-surface-muted p-4"
                role="dialog"
                aria-label="Confirm decline"
              >
                <p className="text-sm text-ink">Decline this request? No email is sent.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => runDecline(row.id)}
                    className="inline-flex min-h-11 items-center rounded-xl bg-warn px-4 text-sm font-medium text-white"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmDeclineId(null)}
                    className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-medium text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

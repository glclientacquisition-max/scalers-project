"use client";

import { PhoneIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition, type FormEvent } from "react";
import {
  approveAccessRequestAction,
  declineAccessRequestAction,
  reopenAccessRequestAction,
  resendAccessRequestInviteAction,
  saveAccessRequestNoteAction,
} from "@/app/admin/(console)/access-requests/actions";
import { waMeHref } from "@/components/WhatsAppLink";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { IconButtonAnchor } from "@/components/ui/IconButton";
import { Segmented } from "@/components/ui/Segmented";
import { Stamp } from "@/components/ui/Stamp";
import type { InviteJoinState } from "@/lib/accessRequestQueries";
import {
  telHrefForAccess,
  type AccessRequestListRow,
  type AccessRequestStatus,
  type AccessRequestStatusFilter,
} from "@/lib/accessRequestLogic";

export type AccessRequestPanelRow = AccessRequestListRow & {
  repeatCount: number;
  inviteState: InviteJoinState | null;
};

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

function statusTone(status: AccessRequestStatus) {
  switch (status) {
    case "pending":
      return "attention" as const;
    case "approved":
      return "ok" as const;
    default:
      return "neutral" as const;
  }
}

function buildListHref(status: AccessRequestStatusFilter, q: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return qs ? `/admin/access-requests?${qs}` : "/admin/access-requests";
}

function AccessRequestsToolbar({
  statusFilter,
  searchQuery,
  counts,
}: {
  statusFilter: AccessRequestStatusFilter;
  searchQuery: string;
  counts: Record<AccessRequestStatus, number>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(searchQuery);

  const onSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      router.push(buildListHref(statusFilter === "all" ? "pending" : statusFilter, draft));
    },
    [draft, router, statusFilter]
  );

  const tabItems = (["pending", "approved", "declined"] as const).map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    count: counts[key],
    href: buildListHref(key, searchQuery),
    active: statusFilter === key,
  }));

  return (
    <div className="mt-4 space-y-3">
      <Segmented items={tabItems} label="Request status" />
      <form onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field id="access-request-search" label="Search" className="min-w-0 flex-1">
          {(field) => (
            <Input
              {...field}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Name, business, email, phone"
              autoComplete="off"
            />
          )}
        </Field>
        <Button type="submit" variant="tonal" size="sm" className="min-h-11 shrink-0">
          Search
        </Button>
        {searchQuery ? (
          <Link
            href={buildListHref(statusFilter === "all" ? "pending" : statusFilter, "")}
            className="inline-flex min-h-11 items-center text-sm font-medium text-accent-deep"
          >
            Clear
          </Link>
        ) : null}
      </form>
    </div>
  );
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.33 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.73 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

function RequestRow({
  row,
  schemaV2,
  onMessage,
  onError,
}: {
  row: AccessRequestPanelRow;
  schemaV2: boolean;
  onMessage: (msg: string | null) => void;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [sendDeclineEmail, setSendDeclineEmail] = useState(false);
  const [noteDraft, setNoteDraft] = useState(row.note ?? "");
  const [noteEditing, setNoteEditing] = useState(false);

  const tel = telHrefForAccess(row.phone);
  const wa = waMeHref(row.phone);

  function run(action: () => Promise<{ error?: string; ok?: boolean }>, success: string) {
    onMessage(null);
    onError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) onError(result.error);
      else onMessage(success);
    });
  }

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">{row.business}</p>
            {row.repeatCount > 1 ? (
              <Stamp tone="attention">Repeat · {row.repeatCount}</Stamp>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">{row.name}</p>
          <p className="mt-0.5 break-all text-sm text-ink-soft">{row.email}</p>
          <p className="mt-0.5 text-sm text-ink-soft">{row.phone}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink">{row.about}</p>
          <p className="mt-2 text-xs text-ink-soft">{formatWhen(row.created_at)}</p>
          {row.decided_at ? (
            <p className="mt-1 text-xs text-ink-soft">
              {row.status}
              {row.decided_by ? ` · ${row.decided_by}` : ""} · {formatWhen(row.decided_at)}
            </p>
          ) : null}
          {schemaV2 && row.status === "declined" && row.decline_reason ? (
            <p className="mt-2 text-sm text-ink-soft">
              <span className="font-medium text-ink">Reason:</span> {row.decline_reason}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Stamp tone={statusTone(row.status)}>{row.status}</Stamp>
          {row.status === "approved" && row.inviteState ? (
            <Stamp tone={row.inviteState === "joined" ? "ok" : "neutral"}>
              {row.inviteState === "joined" ? "Joined" : "Invited"}
            </Stamp>
          ) : null}
          <div className="flex gap-1">
            {tel ? (
              <IconButtonAnchor href={tel} label={`Call ${row.phone}`} tone="accent" size="sm">
                <PhoneIcon className="h-5 w-5" />
              </IconButtonAnchor>
            ) : null}
            {wa ? (
              <IconButtonAnchor
                href={wa}
                target="_blank"
                rel="noreferrer"
                label={`WhatsApp ${row.phone}`}
                tone="whatsapp"
                size="sm"
              >
                <WhatsAppGlyph />
              </IconButtonAnchor>
            ) : null}
          </div>
        </div>
      </div>

      {schemaV2 ? (
        <div className="mt-4 rounded-xl border border-hairline bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta font-medium text-ink">Ops note</p>
            {row.note_updated_at ? (
              <p className="text-caption text-ink-3">
                {row.note_updated_by || "ops"} · {formatWhen(row.note_updated_at)}
              </p>
            ) : null}
          </div>
          {noteEditing ? (
            <div className="mt-2 space-y-2">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                className="text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => saveAccessRequestNoteAction(row.id, noteDraft),
                      "Note saved."
                    )
                  }
                >
                  Save note
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setNoteDraft(row.note ?? "");
                    setNoteEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNoteEditing(true)}
              className="mt-2 w-full min-h-11 rounded-xl border border-dashed border-hairline px-3 py-2 text-left text-sm text-ink-soft hover:border-ink-3 hover:text-ink"
            >
              {row.note?.trim() ? row.note : "Add a private note"}
            </button>
          )}
        </div>
      ) : null}

      {row.status === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveAccessRequestAction(row.id), "Invite sent.")}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="tonal"
            disabled={pending}
            onClick={() => setConfirmDecline(true)}
          >
            Decline
          </Button>
        </div>
      ) : null}

      {row.status === "approved" && row.inviteState === "invited" ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="tonal"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => resendAccessRequestInviteAction(row.id), "Invite resent.")
            }
          >
            Resend invite
          </Button>
        </div>
      ) : null}

      {row.status === "declined" ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="tonal"
            size="sm"
            disabled={pending}
            onClick={() => run(() => reopenAccessRequestAction(row.id), "Back to pending.")}
          >
            Reopen
          </Button>
        </div>
      ) : null}

      {confirmDecline ? (
        <div
          className="mt-4 rounded-xl border border-hairline bg-surface-muted p-4"
          role="dialog"
          aria-label="Decline request"
        >
          <p className="text-sm text-ink">Decline this request?</p>
          {schemaV2 ? (
            <Field id={`decline-reason-${row.id}`} label="Reason (optional)" className="mt-3">
              {(field) => (
                <Textarea
                  {...field}
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={2}
                />
              )}
            </Field>
          ) : null}
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={sendDeclineEmail}
              onChange={(e) => setSendDeclineEmail(e.target.checked)}
              className="h-4 w-4 rounded border-hairline"
            />
            Send polite decline email
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="dangerSolid"
              disabled={pending}
              onClick={() => {
                run(
                  () =>
                    declineAccessRequestAction(row.id, {
                      reason: declineReason,
                      sendEmail: sendDeclineEmail,
                    }),
                  "Request declined."
                );
                setConfirmDecline(false);
              }}
            >
              Decline
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmDecline(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AdminAccessRequestsPanel({
  rows,
  counts,
  statusFilter,
  searchQuery,
  schemaV2,
}: {
  rows: AccessRequestPanelRow[];
  counts: Record<AccessRequestStatus, number>;
  statusFilter: AccessRequestStatusFilter;
  searchQuery: string;
  schemaV2: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <AccessRequestsToolbar
        statusFilter={statusFilter}
        searchQuery={searchQuery}
        counts={counts}
      />

      {message ? <p className="mt-4 text-sm text-ok">{message}</p> : null}
      {error ? (
        <p className="mt-4 text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}

      {!rows.length ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface px-4 py-8 text-sm text-ink-soft">
          No requests in this view.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
          {rows.map((row) => (
            <RequestRow
              key={row.id}
              row={row}
              schemaV2={schemaV2}
              onMessage={setMessage}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

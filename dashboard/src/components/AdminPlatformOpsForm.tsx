"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Stamp } from "@/components/ui/Stamp";
import {
  OPS_NOTICE_KINDS,
  kindLabel,
  parseOpsEmails,
  type OpsKindFlags,
  type OpsNotice,
  type OpsNoticeKind,
  type OpsSettings,
} from "@/lib/platformOpsModel";

function warnKes(minor: number): string {
  return String(Math.round((Number(minor) || 0) / 100));
}

export function AdminPlatformOpsForm({
  settings,
  persisted,
  mailConfigured,
  notices,
}: {
  settings: OpsSettings;
  persisted: boolean;
  mailConfigured: boolean;
  notices: OpsNotice[];
}) {
  const [emails, setEmails] = useState(settings.emails.join(", "));
  const [kinds, setKinds] = useState<OpsKindFlags>(settings.kinds);
  const [warn, setWarn] = useState(warnKes(settings.sautikitWarnMinor));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function post(body: Record<string, unknown>, ok: string) {
    setPending(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/admin/platform-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not update ops mail.");
      setStatus(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update ops mail.");
    } finally {
      setPending(false);
    }
  }

  if (!persisted) {
    return (
      <Empty
        title="Ops mail is not stored yet."
        line="Apply the platform ops SQL, then add staff emails here."
      />
    );
  }

  return (
    <section className="space-y-4 border-t border-line/70 pt-6">
      <div>
        <h2 className="text-title font-medium text-ink">Ops mail</h2>
        <p className="mt-1 text-meta text-ink-2">
          Staff only. Owner leads stay on the owner From address.
        </p>
        {!mailConfigured ? (
          <p className="mt-2 text-meta text-attention">
            Set RESEND_API_KEY and OPS_EMAIL_FROM to send.
          </p>
        ) : null}
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

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void post(
            {
              action: "save_settings",
              emails: parseOpsEmails(emails),
              kinds,
              sautikit_warn_minor: Math.round(Number(warn) * 100),
            },
            "Ops mail saved.",
          );
        }}
      >
        <Field id="ops-mail-emails" label="Staff emails" hint="Comma separated.">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="you@scalers.co.ke, ops@scalers.co.ke"
            />
          )}
        </Field>
        <Field id="ops-mail-warn" label="Phone wallet warn (KES)">
          {(props) => (
            <Input
              {...props}
              type="number"
              min={0}
              step="1"
              className="tabular-nums"
              value={warn}
              onChange={(event) => setWarn(event.target.value)}
            />
          )}
        </Field>
        <fieldset>
          <legend className="text-body font-medium text-ink">Send for</legend>
          <ul className="mt-3 space-y-2">
            {OPS_NOTICE_KINDS.map((kind) => (
              <li key={kind}>
                <label className="inline-flex min-h-11 items-center gap-3 text-body text-ink">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={kinds[kind]}
                    onChange={(event) =>
                      setKinds((prev) => ({ ...prev, [kind]: event.target.checked }))
                    }
                  />
                  {kindLabel(kind)}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" pending={pending}>
            Save
          </Button>
          <Button
            type="button"
            variant="tonal"
            pending={pending}
            onClick={() =>
              void post(
                { action: "test_send", emails: parseOpsEmails(emails) },
                "Test mail sent.",
              )
            }
          >
            Send test
          </Button>
        </div>
      </form>

      {notices.length ? (
        <div>
          <h3 className="text-title font-medium text-ink">Open notices</h3>
          <ul className="mt-3 divide-y divide-line/70">
            {notices.map((notice) => (
              <li key={notice.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">{kindLabel(notice.kind)}</p>
                  <p className="text-meta text-ink-2">{notice.detail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Stamp tone={notice.status === "acked" ? "neutral" : "attention"}>
                    {notice.status === "acked" ? "Seen" : "Open"}
                  </Stamp>
                  {notice.status === "open" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      pending={pending}
                      onClick={() =>
                        void post(
                          { action: "ack", kind: notice.kind as OpsNoticeKind },
                          "Notice marked seen.",
                        )
                      }
                    >
                      Mark seen
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

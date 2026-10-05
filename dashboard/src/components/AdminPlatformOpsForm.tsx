"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import {
  OPS_NOTICE_KINDS,
  emailsFromPeople,
  kindLabel,
  parseOpsPhone,
  parsePeople,
  type OpsKindFlags,
  type OpsNotice,
  type OpsNoticeKind,
  type OpsPerson,
  type OpsSettings,
} from "@/lib/platformOpsModel";

function warnKes(minor: number): string {
  return String(Math.round((Number(minor) || 0) / 100));
}

export function AdminPlatformOpsForm({
  settings,
  persisted,
  notices,
}: {
  settings: OpsSettings;
  persisted: boolean;
  notices: OpsNotice[];
}) {
  const [people, setPeople] = useState<OpsPerson[]>(settings.people);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kinds, setKinds] = useState<OpsKindFlags>(settings.kinds);
  const [warn, setWarn] = useState(warnKes(settings.sautikitWarnMinor));
  const [busy, setBusy] = useState<"save" | "test" | "ack" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function post(body: Record<string, unknown>, ok: string, which: typeof busy) {
    setBusy(which);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/admin/platform-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save.");
      setStatus(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  function addPerson() {
    const next = parsePeople(
      [...people, { id: "", name, phone: parseOpsPhone(phone), email }],
      [],
    );
    setPeople(next);
    setName("");
    setPhone("");
    setEmail("");
  }

  if (!persisted) {
    return (
      <Empty title="No one to notify." />
    );
  }

  return (
    <section id="escalate" className="space-y-4 border-t border-hairline pt-6">
      <h2 className="text-title font-medium text-ink">Escalate</h2>

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

      {people.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {people.map((person) => (
            <ListRow
              key={person.id}
              title={person.name || person.email || person.phone}
              preview={[person.phone, person.email].filter(Boolean).join(" · ")}
              actions={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPeople((prev) => prev.filter((row) => row.id !== person.id))}
                >
                  Remove
                </Button>
              }
            />
          ))}
        </ul>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void post(
            {
              action: "save_settings",
              people,
              kinds,
              sautikit_warn_minor: Math.round(Number(warn) * 100),
            },
            "Saved.",
            "save",
          );
        }}
      >
        <Field id="escalate-name" label="Name">
          {(props) => (
            <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
        <Field id="escalate-phone" label="Phone">
          {(props) => (
            <Input
              {...props}
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>
        <Field id="escalate-email" label="Email">
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Button type="button" variant="tonal" onClick={addPerson}>
          Add person
        </Button>
        <Field id="escalate-warn" label="Warn below" hint="KES">
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
          <legend className="text-body font-medium text-ink">Notify for</legend>
          <ul className="mt-2 space-y-1">
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
        <div className="sticky bottom-[calc(var(--desk-tabbar-h,3.5rem)+env(safe-area-inset-bottom))] z-20 flex flex-wrap gap-3 border-t border-hairline bg-surface py-3 md:static md:border-0 md:py-0">
          <Button type="submit" pending={busy === "save"}>
            Save
          </Button>
          <Button
            type="button"
            variant="tonal"
            pending={busy === "test"}
            onClick={() =>
              void post(
                { action: "test_send", emails: emailsFromPeople(people) },
                "Test sent.",
                "test",
              )
            }
          >
            Send test
          </Button>
        </div>
      </form>

      {notices.length ? (
        <ul className="divide-y divide-hairline">
          {notices.map((notice) => (
            <ListRow
              key={notice.id}
              title={kindLabel(notice.kind)}
              preview={notice.detail || kindLabel(notice.kind)}
              stamp={
                <Stamp tone={notice.status === "acked" ? "neutral" : "attention"}>
                  {notice.status === "acked" ? "Seen" : "Open"}
                </Stamp>
              }
              actions={
                notice.status === "open" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    pending={busy === "ack"}
                    onClick={() =>
                      void post(
                        { action: "ack", kind: notice.kind as OpsNoticeKind },
                        "Seen.",
                        "ack",
                      )
                    }
                  >
                    Mark seen
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}


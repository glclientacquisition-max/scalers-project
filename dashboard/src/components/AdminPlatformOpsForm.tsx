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

async function postOps(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/platform-ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || "Could not save.");
}

export function AdminOpsNotices({ notices }: { notices: OpsNotice[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!notices.length) return null;

  return (
    <section>
      <p className="px-4 text-caption text-ink-3">Open</p>
      {error ? (
        <p className="px-4 text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
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
                  pending={busy === notice.id}
                  onClick={() => {
                    setBusy(notice.id);
                    setError("");
                    void postOps({ action: "ack", kind: notice.kind as OpsNoticeKind })
                      .catch((err) => setError(err instanceof Error ? err.message : "Could not save."))
                      .finally(() => setBusy(null));
                  }}
                >
                  Mark seen
                </Button>
              ) : undefined
            }
          />
        ))}
      </ul>
    </section>
  );
}

export function AdminPlatformOpsForm({
  settings,
  persisted,
}: {
  settings: OpsSettings;
  persisted: boolean;
}) {
  const [people, setPeople] = useState<OpsPerson[]>(settings.people);
  const [adding, setAdding] = useState(settings.people.length === 0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kinds, setKinds] = useState<OpsKindFlags>(settings.kinds);
  const [warn, setWarn] = useState(warnKes(settings.sautikitWarnMinor));
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function run(body: Record<string, unknown>, ok: string, which: "save" | "test") {
    setBusy(which);
    setError("");
    setStatus("");
    try {
      await postOps(body);
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
    if (next.length) setAdding(false);
  }

  if (!persisted) {
    return (
      <section id="escalate">
        <p className="px-4 text-caption text-ink-3">People</p>
        <Empty title="No one to notify." />
      </section>
    );
  }

  return (
    <section id="escalate">
      <p className="px-4 text-caption text-ink-3">People</p>

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
        className="px-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
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
        {adding ? (
          <div className="grid gap-3 py-3 sm:grid-cols-3">
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
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <Button type="button" variant="tonal" size="sm" onClick={addPerson}>
                Add person
              </Button>
              {people.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="py-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)}>
              Add person
            </Button>
          </div>
        )}

        <details className="border-t border-hairline py-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-body text-ink [&::-webkit-details-marker]:hidden">
            Warn below {warn} KES
          </summary>
          <div className="space-y-3 pb-3">
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
              <legend className="text-meta text-ink-2">Notify for</legend>
              <ul className="mt-1 grid grid-cols-2 gap-x-3">
                {OPS_NOTICE_KINDS.map((kind) => (
                  <li key={kind}>
                    <label className="inline-flex min-h-11 items-center gap-2 text-body text-ink">
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
          </div>
        </details>

        <div className="sticky bottom-[calc(var(--desk-tabbar-h,3.5rem)+env(safe-area-inset-bottom))] z-20 flex flex-wrap gap-2 border-t border-hairline bg-surface py-3 md:static md:border-0 md:py-0">
          <Button type="submit" pending={busy === "save"}>
            Save
          </Button>
          <Button
            type="button"
            variant="tonal"
            pending={busy === "test"}
            onClick={() =>
              void run({ action: "test_send", emails: emailsFromPeople(people) }, "Test sent.", "test")
            }
          >
            Send test
          </Button>
        </div>
      </form>
    </section>
  );
}

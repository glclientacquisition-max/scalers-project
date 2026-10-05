"use client";

import { useMemo, useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
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
  const [done, setDone] = useState<Set<string>>(() => new Set());

  const open = notices.filter((notice) => notice.status === "open" && !done.has(notice.id));
  if (!open.length && !error) return null;

  return (
    <section>
      <p className="px-4 text-caption text-ink-3">Needs you</p>
      {error ? (
        <p className="px-4 text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-hairline">
        {open.map((notice) => (
          <ListRow
            key={notice.id}
            title={kindLabel(notice.kind)}
            preview={
              notice.detail && notice.detail !== kindLabel(notice.kind)
                ? notice.detail
                : undefined
            }
            unread
            actions={
              <Button
                type="button"
                variant="tonal"
                size="sm"
                pending={busy === notice.id}
                onClick={() => {
                  setBusy(notice.id);
                  setError("");
                  void postOps({ action: "ack", kind: notice.kind as OpsNoticeKind })
                    .then(() => setDone((prev) => new Set(prev).add(notice.id)))
                    .catch((err) => setError(err instanceof Error ? err.message : "Could not save."))
                    .finally(() => setBusy(null));
                }}
              >
                Done
              </Button>
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
  const [sheet, setSheet] = useState<"person" | "alerts" | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kinds, setKinds] = useState<OpsKindFlags>(settings.kinds);
  const [warn, setWarn] = useState(warnKes(settings.sautikitWarnMinor));
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const onCount = useMemo(
    () => OPS_NOTICE_KINDS.filter((kind) => kinds[kind]).length,
    [kinds],
  );

  async function savePeople(next: OpsPerson[], ok: string) {
    setBusy("save");
    setError("");
    setStatus("");
    try {
      await postOps({
        action: "save_settings",
        people: next,
        kinds,
        sautikit_warn_minor: Math.round(Number(warn) * 100),
      });
      setPeople(next);
      setStatus(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  async function saveAlerts() {
    setBusy("save");
    setError("");
    setStatus("");
    try {
      await postOps({
        action: "save_settings",
        people,
        kinds,
        sautikit_warn_minor: Math.round(Number(warn) * 100),
      });
      setStatus("Saved.");
      setSheet(null);
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
    if (next.length === people.length) return;
    setName("");
    setPhone("");
    setEmail("");
    void savePeople(next, "Saved.").then(() => setSheet(null));
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
    <>
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
                  pending={busy === "remove"}
                  onClick={() =>
                    void savePeople(
                      people.filter((row) => row.id !== person.id),
                      "Saved.",
                    )
                  }
                >
                  Remove
                </Button>
              }
            />
          ))}
          <ListRow
            title="Add person"
            onOpen={() => setSheet("person")}
            when={<ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />}
          />
        </ul>
      </section>

      <section>
        <p className="px-4 text-caption text-ink-3">Alerts</p>
        <ul className="divide-y divide-hairline">
          <ListRow
            title="Low money"
            preview={onCount === 1 ? "1 alert on" : `${onCount} alerts on`}
            when={
              <span className="inline-flex items-center gap-1">
                <span className="tabular-nums">KES {warn}</span>
                <ChevronRightIcon className="h-5 w-5 text-ink-3" aria-hidden="true" />
              </span>
            }
            onOpen={() => setSheet("alerts")}
          />
        </ul>
      </section>

      <Sheet
        open={sheet === "person"}
        onOpenChange={(open) => setSheet(open ? "person" : null)}
        title="Add person"
        footer={
          <Button type="button" pending={busy === "save"} onClick={addPerson}>
            Add
          </Button>
        }
      >
        <div className="space-y-3">
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
        </div>
      </Sheet>

      <Sheet
        open={sheet === "alerts"}
        onOpenChange={(open) => setSheet(open ? "alerts" : null)}
        title="Alerts"
        footer={
          <>
            <Button
              type="button"
              variant="tonal"
              pending={busy === "test"}
              onClick={() => {
                setBusy("test");
                setError("");
                void postOps({ action: "test_send", emails: emailsFromPeople(people) })
                  .then(() => setStatus("Test sent."))
                  .catch((err) => setError(err instanceof Error ? err.message : "Could not save."))
                  .finally(() => setBusy(null));
              }}
            >
              Send test
            </Button>
            <Button type="button" pending={busy === "save"} onClick={() => void saveAlerts()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field id="escalate-warn" label="Low money" hint="KES">
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
          <ul className="divide-y divide-hairline">
            {OPS_NOTICE_KINDS.map((kind) => (
              <li key={kind} className="flex min-h-11 items-center justify-between gap-3 py-1">
                <span className="text-body text-ink">{kindLabel(kind)}</span>
                <Switch
                  label={kindLabel(kind)}
                  checked={kinds[kind]}
                  onCheckedChange={(next) => setKinds((prev) => ({ ...prev, [kind]: next }))}
                />
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { Switch } from "@/components/ui/Switch";
import type { PlatformSonioxVoiceRow } from "@/lib/sonioxVoiceCatalog";

function SheetNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="pb-3 text-body text-attention" role="alert">
      {error}
    </p>
  );
}

function voiceTitle(voice: PlatformSonioxVoiceRow) {
  return voice.description.trim() || "Untitled";
}

function voicePreview(voice: PlatformSonioxVoiceRow) {
  if (voice.is_default) return "Default";
  return voice.is_active ? "Live" : "Off";
}

function voiceStamp(voice: PlatformSonioxVoiceRow) {
  if (voice.is_default) return { tone: "ok" as const, label: "Default" };
  if (voice.is_active) return { tone: "live" as const, label: "Live" };
  return { tone: "neutral" as const, label: "Off" };
}

function faceError(raw: string) {
  if (/uuid/i.test(raw) || raw === "Voice id is not valid.") return "Voice id is not valid.";
  return raw || "Could not save.";
}

export function AdminVoicesManager({
  initialVoices,
}: {
  initialVoices: PlatformSonioxVoiceRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [makeDefault, setMakeDefault] = useState(false);
  const [live, setLive] = useState(true);
  const [sheet, setSheet] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasDefault = initialVoices.some((voice) => voice.is_default);

  async function run(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(faceError(json.error || ""));
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  function openAdd() {
    setEditingId(null);
    setId("");
    setDescription("");
    setSortOrder("100");
    setMakeDefault(!hasDefault);
    setLive(true);
    setError(null);
    setSheet("add");
  }

  function openEdit(voice: PlatformSonioxVoiceRow) {
    setEditingId(voice.id);
    setId(voice.id);
    setDescription(voice.description || "");
    setSortOrder(String(voice.sort_order ?? 100));
    setMakeDefault(Boolean(voice.is_default));
    setLive(Boolean(voice.is_active));
    setError(null);
    setSheet("edit");
  }

  function closeSheet() {
    if (pending) return;
    setSheet(null);
    setEditingId(null);
    setError(null);
  }

  async function save() {
    const ok = await run({
      action: "upsert",
      id,
      description,
      sort_order: Number(sortOrder) || 100,
      is_default: makeDefault,
      is_active: live,
    });
    if (ok) closeSheet();
  }

  async function removeVoice() {
    if (!deleteId) return;
    setDeleting(true);
    const ok = await run({ action: "delete", id: deleteId });
    setDeleting(false);
    if (ok) {
      setDeleteId(null);
      closeSheet();
    }
  }

  return (
    <>
      {!hasDefault ? (
        <section>
          <p className="px-4 text-caption text-ink-3">Needs you</p>
          {initialVoices.length === 0 ? (
            <Empty
              title="No voices."
              line="Add a voice for the desk."
              action={
                <Button type="button" onClick={openAdd}>
                  Add voice
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-hairline">
              <ListRow
                title="No default"
                preview="The desk needs one"
                unread
                onOpen={() => openEdit(initialVoices[0])}
                stamp={<Stamp tone="attention">None</Stamp>}
              />
            </ul>
          )}
        </section>
      ) : null}

      {initialVoices.length > 0 ? (
        <section>
          <p className="px-4 text-caption text-ink-3">Voices</p>
          <ul className="divide-y divide-hairline">
            {initialVoices.map((voice) => {
              const stamp = voiceStamp(voice);
              return (
                <ListRow
                  key={voice.id}
                  title={voiceTitle(voice)}
                  preview={voicePreview(voice)}
                  unread={voice.is_default}
                  onOpen={() => openEdit(voice)}
                  stamp={<Stamp tone={stamp.tone}>{stamp.label}</Stamp>}
                  actions={
                    !voice.is_default ? (
                      <Button
                        type="button"
                        variant="tonal"
                        size="sm"
                        pending={pending}
                        onClick={() => void run({ action: "set_default", id: voice.id })}
                      >
                        Default
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
          <div className="px-4 pt-3">
            <Button type="button" onClick={openAdd}>
              Add voice
            </Button>
          </div>
        </section>
      ) : null}

      <Sheet
        open={sheet !== null}
        onOpenChange={(next) => {
          if (!next) closeSheet();
        }}
        title={editingId ? "Voice" : "Add voice"}
        theme="admin"
        footer={
          <>
            {editingId ? (
              <Button
                type="button"
                variant="danger"
                block
                disabled={pending}
                onClick={() => setDeleteId(editingId)}
              >
                Remove
              </Button>
            ) : null}
            <Button type="button" block pending={pending} disabled={!id.trim()} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <SheetNote error={error} />
        <div className="space-y-4">
          <Field id="voice-name" label="Name" hint="Shown on the desk.">
            {(control) => (
              <Input
                {...control}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={160}
              />
            )}
          </Field>
          <Field id="voice-id" label="Voice id">
            {(control) => (
              <Input
                {...control}
                value={id}
                onChange={(event) => setId(event.target.value)}
                required
                disabled={Boolean(editingId)}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field id="voice-order" label="Order">
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={9999}
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            )}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-ink">Live</p>
            <Switch label="Live" checked={live} onCheckedChange={setLive} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-ink">Default</p>
            <Switch label="Default" checked={makeDefault} onCheckedChange={setMakeDefault} />
          </div>
        </div>
      </Sheet>

      <ConfirmSheet
        open={deleteId !== null}
        theme="admin"
        danger
        pending={deleting}
        title="Remove this voice?"
        confirmLabel="Remove"
        onClose={() => {
          if (!deleting) setDeleteId(null);
        }}
        onConfirm={() => void removeVoice()}
      >
        <p>The desk falls back to the default.</p>
      </ConfirmSheet>
    </>
  );
}

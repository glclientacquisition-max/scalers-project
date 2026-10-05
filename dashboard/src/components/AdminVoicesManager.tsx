"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AdminIdentityList,
  AdminIdentityRow,
  adminRowActionClass,
  adminRowDangerClass,
  adminRowMutedClass,
} from "@/components/AdminIdentityList";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { btnGhost, btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import type { PlatformSonioxVoiceRow } from "@/lib/sonioxVoiceCatalog";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function run(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Request failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function removeVoice() {
    if (!deleteId) return;
    setDeleting(true);
    await run({ action: "delete", id: deleteId });
    setDeleting(false);
    setDeleteId(null);
  }

  function startEdit(voice: PlatformSonioxVoiceRow) {
    setEditingId(voice.id);
    setId(voice.id);
    setDescription(voice.description || "");
    setSortOrder(String(voice.sort_order ?? 100));
    setMakeDefault(Boolean(voice.is_default));
  }

  function resetForm() {
    setEditingId(null);
    setId("");
    setDescription("");
    setSortOrder("100");
    setMakeDefault(false);
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-line/70 pb-6">
        <h2 className="text-title font-medium text-ink">
          {editingId ? "Edit voice" : "Add Soniox voice"}
        </h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run({
              action: "upsert",
              id,
              description,
              sort_order: Number(sortOrder) || 100,
              is_default: makeDefault,
              is_active: true,
            }).then(() => resetForm());
          }}
        >
          <label className="block text-sm">
            <span className="font-medium">Soniox voice UUID</span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              required
              disabled={Boolean(editingId)}
              className={`mt-1 font-mono ${deskFieldClass} disabled:opacity-60`}
              placeholder="7b197f3c-84b4-4404-986f-114e4dac1432"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Description (shown to owners)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={160}
              className={`mt-1 ${deskFieldClass}`}
              placeholder="Warm Kenyan receptionist tone"
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="font-medium">Sort order</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className={`mt-1 w-28 ${deskFieldClass}`}
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              Platform default
            </label>
            <button
              type="submit"
              disabled={pending}
              className={btnPrimary}
            >
              {editingId ? "Save changes" : "Add voice"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className={btnGhost}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        {error ? (
          <p className="mt-3 text-sm text-[var(--warn)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div>
        <h2 className="text-title font-medium text-ink">Catalog</h2>
        <p className="mt-1 text-meta text-ink-2">
          {initialVoices.length} voice{initialVoices.length === 1 ? "" : "s"} in the platform allowlist.
        </p>
        {!initialVoices.length ? (
          <Empty title="No voices yet." line="Add a Soniox voice UUID above." />
        ) : (
          <AdminIdentityList label="Voices">
            {initialVoices.map((voice) => {
              const flags = [
                voice.is_default ? "Default" : "",
                voice.is_active ? "" : "Inactive",
                `Sort ${voice.sort_order}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <AdminIdentityRow
                  key={voice.id}
                  title={voice.description || "Untitled voice"}
                  line={voice.id}
                  aside={flags}
                  actions={
                    <>
                      <button type="button" disabled={pending} onClick={() => startEdit(voice)} className={adminRowMutedClass}>
                        Edit
                      </button>
                      {!voice.is_default ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void run({ action: "set_default", id: voice.id })}
                          className={adminRowActionClass}
                        >
                          Make default
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void run({
                            action: "set_active",
                            id: voice.id,
                            is_active: !voice.is_active,
                          })
                        }
                        className={adminRowMutedClass}
                      >
                        {voice.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setDeleteId(voice.id)}
                        className={adminRowDangerClass}
                      >
                        Delete
                      </button>
                    </>
                  }
                />
              );
            })}
          </AdminIdentityList>
        )}
      </div>
      <ConfirmSheet
        open={deleteId !== null}
        theme="admin"
        danger
        pending={deleting}
        title="Remove this voice"
        confirmLabel="Remove"
        onClose={() => {
          if (!deleting) setDeleteId(null);
        }}
        onConfirm={() => void removeVoice()}
      >
        <p>Workspaces using it will fall back to the default.</p>
      </ConfirmSheet>
    </div>
  );
}

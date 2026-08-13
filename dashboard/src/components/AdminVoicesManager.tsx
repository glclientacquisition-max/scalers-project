"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">
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
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm disabled:opacity-60"
              placeholder="7b197f3c-84b4-4404-986f-114e4dac1432"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Description (shown to owners)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={160}
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
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
                className="mt-1 w-28 rounded-xl border border-[var(--line)] bg-white px-3 py-2"
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
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-60"
            >
              {editingId ? "Save changes" : "Add voice"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="text-sm font-medium text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
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

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Catalog</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          {initialVoices.length} voice{initialVoices.length === 1 ? "" : "s"} in
          the platform allowlist.
        </p>
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {initialVoices.map((voice) => (
            <li
              key={voice.id}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-[var(--ink)]">
                  {voice.description || "Untitled voice"}
                  {voice.is_default ? (
                    <span className="ml-2 text-xs font-normal text-[var(--accent)]">
                      Default
                    </span>
                  ) : null}
                  {!voice.is_active ? (
                    <span className="ml-2 text-xs font-normal text-[var(--ink-soft)]">
                      Inactive
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--ink-soft)]">
                  {voice.id}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                  Sort {voice.sort_order}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startEdit(voice)}
                  className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium"
                >
                  Edit
                </button>
                {!voice.is_default ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void run({ action: "set_default", id: voice.id })}
                    className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium"
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
                  className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium"
                >
                  {voice.is_active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (
                      confirm(
                        "Remove this voice from the catalog? Workspaces using it will fall back to the default."
                      )
                    ) {
                      void run({ action: "delete", id: voice.id });
                    }
                  }}
                  className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--warn)]"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {!initialVoices.length ? (
            <li className="py-6 text-sm text-[var(--ink-soft)]">
              No voices yet. Add your first Soniox cloned voice UUID above.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

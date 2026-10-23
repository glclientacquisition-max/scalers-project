"use client";

import { useState } from "react";
import type { PlatformSonioxVoiceRow as VoiceRow } from "@/lib/sonioxVoiceCatalog";
import { EmptyState, PageHeader, StatusPill } from "@/components/ops";
import { Button } from "@/components/ui/Button";
import "@/styles/ops.css";

function tone(v: VoiceRow): "ok" | "info" | "neutral" {
  if (v.is_default) return "ok";
  if (v.is_active) return "info";
  return "neutral";
}
function label(v: VoiceRow) {
  if (v.is_default) return "Default";
  return v.is_active ? "Live" : "Off";
}

/**
 * Voices (ADMIN_V2): definition cards + dense list. View-only until step-up.
 * Unlock explains that editing waits for secure sign-in. No dead switches.
 */
export function AdminVoicesV2({ voices }: { voices: VoiceRow[] }) {
  const [note, setNote] = useState(false);
  const live = voices.filter((v) => v.is_active).length;
  const off = voices.length - live;
  const def = voices.find((v) => v.is_default);
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3 text-ops-body">
      <PageHeader
        title="Voices"
        count={voices.length}
        actions={
          <Button type="button" variant="primary" size="sm" onClick={() => setNote(true)}>
            Unlock to edit
          </Button>
        }
      />
      <p className="text-ops-label text-ink-2">
        <span className="font-semibold text-ink">{live} live</span>
        {off ? <> · {off} off</> : null}
        {" · View only · unlock to change"}
      </p>
      {note ? (
        <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status">
          Secure sign-in is next. Adding or changing voices waits for step-up — this button does not change them yet.{" "}
          <button type="button" className="font-semibold text-ink underline-offset-2 hover:underline" onClick={() => setNote(false)}>
            Dismiss
          </button>
        </p>
      ) : null}

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="flex justify-between border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">At a glance</h2>
          <span className="text-ops-label text-ink-2">{voices.length} total</span>
        </header>
        <dl>
          {[
            ["Default", def?.description.trim() || "None"],
            ["Live", String(live)],
            ["Off", String(off)],
          ].map(([l, v]) => (
            <div key={l} className="grid grid-cols-1 gap-0.5 border-b border-hairline px-ops-3 py-ops-2 last:border-b-0 md:grid-cols-[12rem_1fr] md:gap-ops-4">
              <dt className="text-ink-2">{l}</dt>
              <dd className="font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </article>

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="flex justify-between border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">All voices</h2>
          <span className="text-ops-label text-ink-2">Order is play order</span>
        </header>
        {voices.length === 0 ? (
          <div className="px-ops-3 py-ops-3">
            <EmptyState title="No voices yet." />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-hairline md:hidden">
              {voices.map((v) => (
                <li key={v.id} className="flex min-h-ops-touch items-center justify-between gap-2 px-ops-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{v.description.trim() || "Untitled"}</span>
                    <span className="text-ops-label text-ink-2">Order {v.sort_order}</span>
                  </span>
                  <StatusPill tone={tone(v)}>{label(v)}</StatusPill>
                </li>
              ))}
            </ul>
            <table className="hidden w-full text-ops-body md:table">
              <thead className="bg-canvas text-ops-label text-ink-2">
                <tr className="h-ops-row border-b border-hairline">
                  <th className="px-ops-3 text-start font-normal">Voice</th>
                  <th className="px-ops-3 text-start font-normal">Status</th>
                  <th className="px-ops-3 text-start font-normal">Role</th>
                  <th className="px-ops-3 text-end font-normal">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {voices.map((v) => (
                  <tr key={v.id} className="h-ops-row">
                    <td className="px-ops-3 font-semibold text-ink">{v.description.trim() || "Untitled"}</td>
                    <td className="px-ops-3">
                      <StatusPill tone={tone(v)}>{label(v)}</StatusPill>
                    </td>
                    <td className="px-ops-3 text-ink-2">{v.is_default ? "Default for new desks" : v.is_active ? "Available" : "Hidden"}</td>
                    <td className="px-ops-3 text-end tabular-nums text-ink-2">{v.sort_order}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </article>

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">Editing</h2>
        </header>
        <dl>
          {[
            ["Who can change", "Operators with step-up"],
            ["Add a voice", "Unlock, then secure sign-in"],
            ["Set default", "Unlock, then secure sign-in"],
            ["Turn off", "Unlock, then secure sign-in"],
          ].map(([l, v]) => (
            <div key={l} className="grid grid-cols-1 gap-0.5 border-b border-hairline px-ops-3 py-ops-2 last:border-b-0 md:grid-cols-[12rem_1fr] md:gap-ops-4">
              <dt className="text-ink-2">{l}</dt>
              <dd className="font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </article>
    </div>
  );
}

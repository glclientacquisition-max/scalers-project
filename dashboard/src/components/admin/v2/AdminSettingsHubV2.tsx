"use client";

import Link from "next/link";
import { useState } from "react";
import { holdSettings, type SettingsHubRaw } from "@/lib/ops/settingsHubView";
import { PageHeader } from "@/components/ops";
import { Button } from "@/components/ui/Button";
import "@/styles/ops.css";

const WHEN = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Nairobi",
});

/**
 * Settings hub (ADMIN_V2): one Number hold card — three definition rows, view-only, one Unlock CTA.
 * Definition rows only; no interactive chrome. Secure sign-in is next; the button is honest about that.
 */
export function AdminSettingsHubV2({ raw }: { raw: SettingsHubRaw | null }) {
  const rows = holdSettings(raw);
  const [note, setNote] = useState(false);
  const here = rows.every((r) => r.state !== "absent");
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3 pe-ops-4 text-ops-body">
      <PageHeader
        title="General"
        actions={
          <Button type="button" variant="primary" size="sm" onClick={() => setNote(true)}>
            Unlock to edit
          </Button>
        }
      />
      <article className="overflow-hidden rounded-sm border border-hairline bg-surface" data-number-hold="">
        <header className="flex flex-wrap items-start justify-between gap-x-ops-4 gap-y-1 border-b border-hairline px-ops-3 py-ops-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink">Number hold</h2>
            <p className="mt-0.5 text-ops-label text-ink-2">
              {here
                ? "What happens to a business's number when the line stops."
                : "Hold settings are not on this environment. Values below are not invented."}
            </p>
          </div>
          <p className="shrink-0 text-ops-label text-ink-2">
            View only · unlock to change
            {raw?.updated_at ? <span className="ms-1 block tabular-nums md:inline">· {WHEN.format(new Date(raw.updated_at))}</span> : null}
          </p>
        </header>
        <dl>
          {rows.map((v) => (
            <div key={v.label} className="grid grid-cols-1 gap-1 border-b border-hairline px-ops-3 py-ops-3 last:border-b-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-ops-4">
              <dt className="text-ink-2">{v.label}</dt>
              <dd className="min-w-0">
                <div className="font-semibold tabular-nums text-ink">{v.value}</div>
                <p className="mt-0.5 text-ops-label text-ink-2">{v.note}</p>
              </dd>
            </div>
          ))}
        </dl>
        {note ? (
          <p className="border-t border-hairline bg-canvas px-ops-3 py-ops-3 text-ops-label text-ink-2" role="status" data-unlock-note="">
            Secure sign-in is next. Editing these three values waits for step-up — this button does not change them yet.{" "}
            <button type="button" className="font-semibold text-ink underline-offset-2 hover:underline" onClick={() => setNote(false)}>
              Dismiss
            </button>
          </p>
        ) : (
          <p className="border-t border-hairline px-ops-3 py-ops-3 text-ops-label text-ink-2">
            To change these, unlock with secure sign-in. The Unlock button only opens that note until step-up lands.
          </p>
        )}
      </article>
      <section aria-label="Other settings" className="flex flex-col">
        <h2 className="px-ops-3 pb-ops-1 text-ops-label font-semibold uppercase tracking-wide text-ink-2">Also in Settings</h2>
        <ul className="divide-y divide-hairline border border-hairline bg-surface">
          {[
            ["/admin/settings/services", "Services", "Service list businesses pick from."],
            ["/admin/settings/voices", "Voices", "Assistant voices available to shops."],
            ["/admin/settings/audit", "Audit log", "Every admin change, newest first."],
          ].map(([href, label, note]) => (
            <li key={href}>
              <Link href={href} className="flex min-h-ops-touch items-baseline justify-between gap-ops-4 px-ops-3 py-ops-3 hover:bg-surface-2">
                <span className="font-semibold text-ink">{label}</span>
                <span className="min-w-0 flex-1 text-end text-ops-label text-ink-2 md:text-start">{note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="How number hold works" className="border border-hairline bg-surface">
        <h2 className="flex items-baseline justify-between gap-ops-4 border-b border-hairline px-ops-3 py-ops-2 text-ops-label font-semibold uppercase tracking-wide text-ink-2">
          <span>How it works</span>
          <span className="font-normal normal-case tracking-normal">using the values above</span>
        </h2>
        <ol className="divide-y divide-hairline text-ops-body">
          {[
            ["Line stops", "Trial ends or the line is suspended. Calls still reach the shop."],
            ["Voicemail window", "Callers can leave a message for a few days, then hear that the line is off."],
            [
              "Number hold",
              here
                ? `Hold after release is ${rows[0].value}. The number stays for ${rows[1].value.toLowerCase()} so the business can come back. Fee: ${rows[2].value}.`
                : "Hold settings are not on this environment, so this step cannot be summarised here.",
            ],
            [
              "Released",
              here && rows[0].value === "Off"
                ? "Hold is Off: the number goes back to the pool as soon as the line stops."
                : "After the hold length, the number goes back to the pool for someone else.",
            ],
          ].map(([t, n], i) => (
            <li key={t} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-ops-3 px-ops-3 py-ops-3">
              <span className="tabular-nums text-ink-2">{i + 1}</span>
              <span>
                <span className="font-semibold text-ink">{t}</span>
                <span className="mt-0.5 block text-ops-label text-ink-2">{n}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

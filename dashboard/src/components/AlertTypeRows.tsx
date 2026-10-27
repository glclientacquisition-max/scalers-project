"use client";

import { useState } from "react";
import {
  ALERT_CHANNELS,
  ALERT_CHANNEL_LABEL,
  ALERT_TYPE_META,
  alertMasterOn,
  parseAlertTypes,
  resetAlertChoices,
  toggleAlertCell,
  type AlertChannelId,
  type AlertTypeId,
  type NotifyChannels,
} from "@/lib/notifyChannels";

const MASTER_OFF_LINE: Record<Exclude<AlertChannelId, "push">, string> = {
  sms: "SMS is off for the whole business.",
  whatsapp: "WhatsApp is off for the whole business.",
  email: "Email is off for the whole business.",
};

/**
 * How we notify › What alerts you get. One block per alert, a 2x2 set of
 * labelled toggle buttons (44px). Brief: plans/2026-10-25-alert-type-grid.md.
 */
export function AlertTypeRows({
  value,
  onChange,
}: {
  value: NotifyChannels;
  onChange: (next: NotifyChannels) => void;
}) {
  const [blocked, setBlocked] = useState<AlertTypeId | null>(null);
  const cells = parseAlertTypes(value);
  const offLines = (["sms", "whatsapp", "email"] as const)
    .filter((ch) => !alertMasterOn(value, ch))
    .map((ch) => MASTER_OFF_LINE[ch]);
  const customised = Boolean(value.by_type && Object.keys(value.by_type).length);

  return (
    <section className="min-w-0 w-full space-y-1.5" aria-labelledby="alert-types-title">
      <div className="px-1">
        <h2 id="alert-types-title" className="text-meta font-medium text-ink-2">
          What alerts you get
        </h2>
        <p className="text-meta text-ink-2">Pick where each alert goes.</p>
      </div>
      <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface px-4">
        {ALERT_TYPE_META.map((meta) => (
          <div key={meta.id} className="py-4">
            <p className="text-body font-semibold text-ink">{meta.label}</p>
            <p className="mb-3 text-meta text-ink-2">{meta.what}</p>
            <div role="group" aria-label={meta.label} className="grid grid-cols-2 gap-2">
              {ALERT_CHANNELS.map((ch) => {
                const master = alertMasterOn(value, ch);
                const on = cells[meta.id][ch];
                const label = ALERT_CHANNEL_LABEL[ch];
                return (
                  <button
                    key={ch}
                    type="button"
                    disabled={!master}
                    aria-pressed={master ? on : undefined}
                    aria-label={master ? `${meta.label}: ${label}` : `${meta.label}: ${label} (off for the business)`}
                    onClick={() => {
                      const next = toggleAlertCell(value, meta.id, ch);
                      if (!next) {
                        setBlocked(meta.id);
                        return;
                      }
                      setBlocked(null);
                      onChange(next);
                    }}
                    className={
                      "min-h-11 min-w-0 truncate rounded-lg border px-2 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 " +
                      (!master
                        ? "cursor-not-allowed border-transparent bg-canvas text-ink-2/60 line-through"
                        : on
                          ? "border-accent bg-accent/10 font-semibold text-accent"
                          : "border-hairline bg-surface text-ink")
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {blocked === meta.id ? (
              <p role="status" className="mt-2 text-meta text-ink-2">
                Missed calls need at least one way to reach you.
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3 px-1">
        <p className="text-meta text-ink-2">{offLines.join(" ")}</p>
        {customised ? (
          <button
            type="button"
            onClick={() => {
              setBlocked(null);
              onChange(resetAlertChoices(value));
            }}
            className="min-h-11 shrink-0 px-1 text-body font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Reset
          </button>
        ) : null}
      </div>
    </section>
  );
}

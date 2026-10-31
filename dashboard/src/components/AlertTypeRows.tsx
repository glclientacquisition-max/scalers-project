"use client";

import { useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Sheet } from "@/components/ui/Sheet";
import { ToolSwitch } from "@/components/settingsUi";
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

function channelSummary(value: NotifyChannels, type: AlertTypeId): string {
  const cells = parseAlertTypes(value);
  const on = ALERT_CHANNELS.filter((ch) => alertMasterOn(value, ch) && cells[type][ch]).map(
    (ch) => ALERT_CHANNEL_LABEL[ch]
  );
  return on.length ? on.join(" · ") : "Off";
}

/**
 * How we notify. Each alert is one row. The sheet holds one switch per channel.
 */
export function AlertTypeRows({
  value,
  onChange,
}: {
  value: NotifyChannels;
  onChange: (next: NotifyChannels) => void;
}) {
  const [openId, setOpenId] = useState<AlertTypeId | null>(null);
  const [blocked, setBlocked] = useState<AlertTypeId | null>(null);
  const open = ALERT_TYPE_META.find((meta) => meta.id === openId) ?? null;
  const cells = parseAlertTypes(value);
  const offLines = (["sms", "whatsapp", "email"] as const)
    .filter((ch) => !alertMasterOn(value, ch))
    .map((ch) => MASTER_OFF_LINE[ch]);
  const customised = Boolean(value.by_type && Object.keys(value.by_type).length);

  return (
    <section className="min-w-0 w-full" aria-labelledby="alert-types-title">
      <h2 id="alert-types-title" className="sr-only">
        What alerts you get
      </h2>
      <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {ALERT_TYPE_META.map((meta) => (
          <li key={meta.id} className="border-b border-hairline last:border-b-0">
            <button
              type="button"
              aria-pressed={ALERT_CHANNELS.some((ch) => cells[meta.id][ch])}
              onClick={() => setOpenId(meta.id)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{meta.label}</span>
                <span className="block truncate text-meta text-ink-2">{channelSummary(value, meta.id)}</span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {offLines.length || customised ? (
        <div className="mt-2 flex min-h-11 items-center justify-between gap-3 px-1">
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
      ) : null}
      <Sheet
        open={open != null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        title={open?.label || "Alert"}
      >
        {open ? (
          <div className="space-y-3">
            <p className="text-body text-ink-2">{open.what}</p>
            <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
              {ALERT_CHANNELS.map((ch) => {
                const master = alertMasterOn(value, ch);
                const on = cells[open.id][ch];
                const label = ALERT_CHANNEL_LABEL[ch];
                return (
                  <div key={ch} className="flex min-h-11 items-center justify-between gap-3 px-4">
                    <span className="text-body text-ink">{label}</span>
                    <ToolSwitch
                      checked={Boolean(master && on)}
                      disabled={!master}
                      label={master ? `${open.label}: ${label}` : `${open.label}: ${label} (off for the business)`}
                      onChange={() => {
                        const next = toggleAlertCell(value, open.id, ch);
                        if (!next) {
                          setBlocked(open.id);
                          return;
                        }
                        setBlocked(null);
                        onChange(next);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {blocked === open.id ? (
              <p role="status" className="text-meta text-ink-2">
                Missed calls need at least one way to reach you.
              </p>
            ) : null}
            {!alertMasterOn(value, "sms") ? (
              <p className="text-meta text-ink-2">SMS is off for the whole business.</p>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

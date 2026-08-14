"use client";

import type { ReactNode } from "react";
import {
  NOTIFY_CHANNEL_META,
  type NotifyChannelId,
  type NotifyChannels,
} from "@/lib/notifyChannels";
import { ToolSwitch } from "@/components/settingsUi";

function SmsLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z" />
      <path d="M7 9h10v2H7zm0-3h10v2H7zm0 6h7v2H7z" />
    </svg>
  );
}

function WhatsAppLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.33 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.73 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

function EmailLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
    </svg>
  );
}

const LOGO: Record<NotifyChannelId, (p: { className?: string }) => ReactNode> = {
  sms: SmsLogo,
  whatsapp: WhatsAppLogo,
  email: EmailLogo,
};

const LOGO_TONE: Record<NotifyChannelId, string> = {
  sms: "bg-[#0ea5e9]/15 text-[#0284c7]",
  whatsapp: "bg-[#25D366]/15 text-[#128C7E]",
  email: "bg-[#6366f1]/15 text-[#4f46e5]",
};

export function NotifyChannelPicker({
  value,
  onChange,
}: {
  value: NotifyChannels;
  onChange: (next: NotifyChannels) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium text-[var(--ink)]">Notify channels</h3>
        <p className="mt-0.5 text-xs text-ink-soft">
          Choose how the team gets escalate and lead alerts. Grey channels are not live on
          Scalers yet.
        </p>
      </div>
      <ul className="space-y-2">
        {NOTIFY_CHANNEL_META.map((meta) => {
          const Logo = LOGO[meta.id];
          const enabled = Boolean(value[meta.id]);
          const locked = !meta.available;
          return (
            <li
              key={meta.id}
              className={[
                "flex items-center gap-3 rounded-xl border px-3 py-3 transition",
                locked
                  ? "border-line/70 bg-surface/60 opacity-55 grayscale"
                  : enabled
                    ? "border-[#0096FF]/35 bg-[#0096FF]/5"
                    : "border-line bg-white",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  LOGO_TONE[meta.id],
                ].join(" ")}
              >
                <Logo className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{meta.label}</p>
                  {locked ? (
                    <span className="rounded-md bg-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                      Coming soon
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-ink-soft">
                  {locked ? meta.unavailableLabel : meta.description}
                </p>
              </div>
              <ToolSwitch
                checked={enabled && !locked}
                disabled={locked}
                label={`${meta.label} notify`}
                onChange={(next) => {
                  if (locked) return;
                  onChange({ ...value, [meta.id]: next });
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

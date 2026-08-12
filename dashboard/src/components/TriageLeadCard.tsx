import Link from "next/link";
import {
  MarkLeadArchiveButton,
  MarkLeadDoneButton,
} from "@/components/MarkLeadDoneButton";
import { waMeHref } from "@/components/WhatsAppLink";
import {
  followUpWhatsAppMessage,
  formatCallWhen,
  type Lead,
} from "@/lib/callsTriage";

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.33 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.73 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

function OpenGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

/**
 * Overview / inbox lead row: one primary WhatsApp hit target, muted secondary actions.
 */
export function TriageLeadCard({
  lead,
  businessName,
  openHref,
}: {
  lead: Lead;
  businessName: string;
  openHref?: string;
}) {
  const message = followUpWhatsAppMessage({
    businessName,
    name: lead.name,
    reason: lead.reason,
  });
  const waHref = waMeHref(lead.call.caller_number, message);
  const displayName = lead.name?.trim() || "Unknown caller";
  const phone = lead.call.caller_number?.trim() || "No number";
  const detailHref = openHref ?? `/calls/${lead.call.id}?from=new`;

  return (
    <li
      className={[
        "rounded-2xl border bg-surface px-5 py-5",
        lead.urgent ? "border-warn/45" : "border-line",
      ].join(" ")}
    >
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
          {formatCallWhen(lead.call.created_at)}
          {lead.urgent ? (
            <span className="ml-2 normal-case tracking-normal text-warn">Urgent</span>
          ) : null}
        </p>
        <p className="truncate text-lg font-semibold text-ink">{displayName}</p>
        <p className="line-clamp-2 text-sm leading-relaxed text-ink-soft">
          {lead.reason?.trim() || "No reason captured"}
        </p>
      </div>

      {waHref ? (
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex min-h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-xl bg-[#0096FF] px-4 py-3.5 text-center text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2"
        >
          <span className="inline-flex items-center gap-2 text-base font-semibold">
            <WhatsAppGlyph className="h-5 w-5 shrink-0" />
            Reply on WhatsApp
          </span>
          <span className="text-sm font-medium text-white/90">{phone}</span>
        </a>
      ) : (
        <p className="mt-5 rounded-xl border border-line bg-surface-muted/50 px-4 py-3 text-center text-sm font-medium text-ink-soft">
          {phone}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-1 border-t border-line/80 pt-3">
        <MarkLeadArchiveButton callId={lead.call.id} variant="icon" />
        <MarkLeadDoneButton callId={lead.call.id} variant="icon" />
        <Link
          href={detailHref}
          aria-label="Open call"
          title="Open call"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
        >
          <OpenGlyph className="h-4 w-4" />
        </Link>
      </div>
    </li>
  );
}

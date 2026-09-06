import Link from "next/link";
import {
  MarkLeadArchiveButton,
  MarkLeadDoneButton,
} from "@/components/MarkLeadDoneButton";
import { waMeHref } from "@/components/WhatsAppLink";
import { callResolutionLabel } from "@/lib/supabase";
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

const primaryActionClass =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0096FF] px-4 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition duration-150 hover:bg-[#0088e8] active:scale-[0.99] active:bg-[#007acc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 sm:min-h-11 sm:w-auto sm:min-w-[9.5rem]";

/**
 * Home new-lead row: identity, captured reason, when, outcome, one primary action.
 * Lives inside a divided list. Investigation stays on /calls/[id].
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
  const phone = lead.call.caller_number?.trim() || "";
  const reason = lead.reason?.trim() || "";
  const detailHref = openHref ?? `/calls/${lead.call.id}?from=new`;
  const outcome =
    lead.resolution && lead.resolution !== "unknown"
      ? callResolutionLabel(lead.resolution)
      : null;

  return (
    <li className={lead.urgent ? "group relative bg-warn-soft/60" : "group relative"}>
      <article className="relative flex flex-col gap-3 px-4 py-3 transition-colors duration-150 group-hover:bg-[#0096FF]/[0.04] group-focus-within:bg-[#0096FF]/[0.04] sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5 sm:py-3.5">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-transparent transition-colors duration-150 group-hover:bg-[#0096FF] group-focus-within:bg-[#0096FF]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] text-ink-soft">
            {formatCallWhen(lead.call.created_at)}
            {lead.urgent ? (
              <span className="ml-2 font-sans text-xs font-medium text-warn">Urgent</span>
            ) : null}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-ink">{displayName}</h3>
          {phone ? (
            <p className="mt-0.5 truncate font-mono text-xs text-ink-soft">{phone}</p>
          ) : null}
          {reason ? (
            <p className="mt-1 line-clamp-1 text-sm text-ink">{reason}</p>
          ) : null}
          {outcome ? (
            <p className="mt-0.5 text-xs text-ink-soft">{outcome}</p>
          ) : null}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              aria-label={`Reply to ${displayName} on WhatsApp`}
              className={primaryActionClass}
            >
              <WhatsAppGlyph className="h-4 w-4 shrink-0" />
              WhatsApp
            </a>
          ) : (
            <Link href={detailHref} className={primaryActionClass}>
              Open
            </Link>
          )}
          <div className="flex items-center justify-end gap-1">
            <MarkLeadArchiveButton callId={lead.call.id} variant="icon" />
            <MarkLeadDoneButton callId={lead.call.id} variant="icon" />
            {waHref ? (
              <Link
                href={detailHref}
                className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-[#0096FF] transition duration-150 hover:text-[#005ccc] active:text-[#004a99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
              >
                Open
              </Link>
            ) : null}
          </div>
        </div>
      </article>
    </li>
  );
}

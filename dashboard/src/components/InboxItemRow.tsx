import Link from "next/link";
import { InboxJobActions } from "@/components/InboxJobActions";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { followUpWhatsAppMessage, formatCallWhenRelative } from "@/lib/callsTriage";
import {
  holdTypeLabel,
  itemSignalLabel,
  type InboxItem,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";

export function inboxTableKind(
  purpose: InboxPurposeFilterId
): "hold" | "job" | "mixed" {
  if (purpose === "hold") return "hold";
  if (purpose === "job") return "job";
  return "mixed";
}

export function inboxOpenLabel(item: InboxItem) {
  return item.hold || item.job ? "Call" : "Open";
}

function inboxCopy(
  item: InboxItem,
  purpose: InboxPurposeFilterId,
  vertical: string | null | undefined,
  businessName: string
) {
  const kind = inboxTableKind(purpose);
  const who = item.callerName || item.callerPhone || "Caller";
  const message = followUpWhatsAppMessage({
    businessName,
    name: item.callerName,
    reason: item.headline,
  });
  const openHref = item.callId ? `/calls/${item.callId}?from=${purpose}` : null;
  const needed = item.hold?.when_text?.trim() || "Anytime";
  const visit = item.job?.when_text?.trim() || "Time TBD";
  const place = item.job?.address_landmark?.trim() || "Ask on the call";
  const stamp = itemSignalLabel(item, vertical);
  const when = formatCallWhenRelative(item.createdAt);
  return { kind, who, message, openHref, needed, visit, place, stamp, when };
}

function InboxTrailingAction({
  item,
  message,
  extra,
}: {
  item: InboxItem;
  message: string;
  extra: boolean;
}) {
  if (item.job) {
    return <InboxJobActions id={item.job.id} status={item.job.status} extra={extra} />;
  }
  if (item.hold) {
    return <RequestStatusToggle id={item.hold.id} status={item.hold.status} extra={extra} />;
  }
  if (item.callerPhone) {
    return extra ? (
      <WhatsAppLink
        number={item.callerPhone}
        message={message}
        variant="primary"
        label="WhatsApp"
      />
    ) : (
      <WhatsAppLink number={item.callerPhone} message={message} variant="icon" />
    );
  }
  return null;
}

function WhoName({
  item,
  who,
  link,
}: {
  item: InboxItem;
  who: string;
  link: boolean;
}) {
  if (link && item.contactId) {
    return (
      <Link
        href={`/contacts/${item.contactId}`}
        className="text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
      >
        {who}
      </Link>
    );
  }
  return <>{who}</>;
}

export function InboxTableRow({
  item,
  businessName,
  purpose,
  vertical,
}: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
}) {
  const { kind, who, message, openHref, needed, visit, place, stamp, when } = inboxCopy(
    item,
    purpose,
    vertical,
    businessName
  );
  const openLabel = inboxOpenLabel(item);

  return (
    <tr
      className={[
        "group border-t border-line/70 transition duration-150",
        "hover:bg-[#0096FF]/[0.04] active:bg-[#0096FF]/[0.07]",
        item.urgent ? "bg-warn-soft/50" : "",
        item.needsYou ? "" : "opacity-[0.92]",
      ].join(" ")}
    >
      {kind === "hold" ? (
        <>
          <td className="px-5 py-4 align-top">
            <p className="text-sm font-semibold tracking-tight text-ink">{item.headline}</p>
            {item.hold ? (
              <p className="mt-0.5 text-sm text-ink-soft">
                {holdTypeLabel(item.hold.request_type, vertical)}
              </p>
            ) : null}
          </td>
          <td className="px-5 py-4 align-top font-medium text-ink">
            <WhoName item={item} who={item.callerName || "Caller"} link />
          </td>
          <td className="px-5 py-4 align-top text-sm text-ink-soft">{needed}</td>
        </>
      ) : null}

      {kind === "job" ? (
        <>
          <td className="px-5 py-4 align-top">
            <p className="text-sm font-semibold tracking-tight text-ink">{visit}</p>
            <p className="mt-0.5 text-sm text-ink-soft">{item.headline}</p>
          </td>
          <td className="px-5 py-4 align-top font-medium text-ink">
            <WhoName item={item} who={item.callerName || "Caller"} link />
          </td>
          <td className="px-5 py-4 align-top text-sm text-ink-soft">{place}</td>
        </>
      ) : null}

      {kind === "mixed" ? (
        <>
          <td className="px-5 py-4 align-top">
            <p className="text-sm font-semibold tracking-tight text-ink">
              <WhoName item={item} who={who} link />
            </p>
            <p className="mt-0.5 text-sm text-ink">{item.headline}</p>
            {item.detail ? (
              <p className="mt-1 line-clamp-1 text-sm text-ink-soft">{item.detail}</p>
            ) : null}
          </td>
          <td className="px-5 py-4 align-top">
            <InboxPurposeChip purpose={item.purpose} label={stamp} />
          </td>
          <td className="whitespace-nowrap px-5 py-4 align-top text-sm text-ink-soft">{when}</td>
        </>
      ) : null}

      <td className="px-5 py-4 align-top">
        <div className="flex justify-end">
          <InboxTrailingAction item={item} message={message} extra />
        </div>
      </td>
      <td className="px-5 py-4 align-middle text-right">
        {openHref ? (
          <Link
            href={openHref}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
          >
            {openLabel}
          </Link>
        ) : (
          <span className="text-sm text-ink-soft">No call</span>
        )}
      </td>
    </tr>
  );
}

/** iOS Mail / Material list row. One primary verb. Row body opens the call. */
export function InboxPhoneRow({
  item,
  businessName,
  purpose,
  vertical,
}: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
}) {
  const { kind, who, message, openHref, needed, visit, place, stamp, when } = inboxCopy(
    item,
    purpose,
    vertical,
    businessName
  );
  const work = kind === "job" ? item.headline : kind === "hold" ? item.headline : item.headline;
  const meta = kind === "hold" ? needed : kind === "job" ? visit : when;
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold tracking-tight text-ink">{who}</p>
        <p className="shrink-0 text-xs text-ink-soft">{meta}</p>
      </div>
      <p className="mt-0.5 line-clamp-2 text-sm text-ink">{work}</p>
      {kind === "job" ? (
        <p className="mt-0.5 line-clamp-1 text-sm text-ink-soft">{place}</p>
      ) : null}
      {kind === "mixed" ? (
        <p className="mt-1">
          <InboxPurposeChip purpose={item.purpose} label={stamp} />
        </p>
      ) : null}
    </>
  );

  return (
    <li
      className={[
        "flex items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0",
        item.urgent ? "bg-warn-soft/50" : "",
        item.needsYou ? "" : "opacity-[0.92]",
      ].join(" ")}
    >
      {openHref ? (
        <Link
          href={openHref}
          className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
        >
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <div className="flex shrink-0 items-center self-center">
        <InboxTrailingAction item={item} message={message} extra={false} />
      </div>
    </li>
  );
}

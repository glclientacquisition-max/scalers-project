import Link from "next/link";
import { CallLink } from "@/components/CallLink";
import { InboxJobActions } from "@/components/InboxJobActions";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import {
  DeskRowHit,
  deskRowActionClass,
  deskRowMutedClass,
} from "@/components/ui/deskRowHit";
import { DeskLandSurface } from "@/components/ui/DeskLand";
import {
  deskPreviewCellClass,
  deskPreviewClass,
  deskShiftClass,
} from "@/components/ui/deskChrome";
import {
  RowIdentity,
  RowStateDot,
  deskRowWeightClass,
} from "@/components/ui/deskRow";
import { followUpWhatsAppMessage, formatCallWhenRelative } from "@/lib/callsTriage";
import {
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
  const hasJob = Boolean(item.job);
  const hasHold = Boolean(item.hold);
  const needed = item.hold?.when_text?.trim() || "Anytime";
  const visit = item.job?.when_text?.trim() || "Time TBD";
  const place = item.job?.address_landmark?.trim() || "Ask on the call";
  const stamp = itemSignalLabel(item, vertical);
  const when = formatCallWhenRelative(item.createdAt);
  const showJob = kind === "job" && hasJob;
  const showHold = kind === "hold" && hasHold;
  const showMixed = !showJob && !showHold;
  return {
    kind,
    who,
    message,
    openHref,
    needed,
    visit,
    place,
    stamp,
    when,
    hasJob,
    showJob,
    showHold,
    showMixed,
  };
}

/**
 * Inbox Action dock. One primary verb. Never Open, View, SMS, or email.
 * Job → Confirm. Hold → Done. Else + number → Call then WhatsApp.
 */
function InboxTrailingAction({
  item,
  message,
}: {
  item: InboxItem;
  message: string;
}) {
  if (item.job) {
    return <InboxJobActions id={item.job.id} status={item.job.status} extra={false} />;
  }
  if (item.hold) {
    return <RequestStatusToggle id={item.hold.id} status={item.hold.status} extra={false} />;
  }
  if (item.callerPhone) {
    return (
      <div className="flex shrink-0 items-center justify-end gap-2">
        <CallLink number={item.callerPhone} />
        <WhatsAppLink number={item.callerPhone} message={message} variant="icon" />
      </div>
    );
  }
  return null;
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
  const {
    kind,
    who,
    message,
    openHref,
    needed,
    visit,
    place,
    stamp,
    when,
    hasJob,
    showHold,
  } = inboxCopy(item, purpose, vertical, businessName);

  const live = item.purpose === "live";

  return (
    <DeskLandSurface
      as="tr"
      id={item.id}
      className={[
        "group relative border-t border-line/70",
        deskShiftClass,
        openHref ? "cursor-pointer" : "",
        "hover:bg-accent/[0.04] active:bg-accent/[0.07]",
        item.urgent ? "bg-warn-soft/50" : "",
      ].join(" ")}
    >
      {kind === "hold" ? (
        <>
          <td className={`px-5 py-4 align-top ${deskPreviewCellClass}`}>
            <DeskRowHit href={openHref} label="Conversation" />
            <div className={`${deskRowMutedClass} flex items-center gap-3`}>
              <RowIdentity name={item.callerName} />
              <div className="min-w-0">
                <p
                  className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.needsYou)}`}
                >
                  {item.headline}
                </p>
              </div>
            </div>
          </td>
          <td className={`${deskRowMutedClass} max-w-[10rem] px-5 py-4 align-top font-medium text-ink`}>
            <p className={deskPreviewClass}>{item.callerName || "Caller"}</p>
          </td>
          <td className={`${deskRowMutedClass} px-5 py-4 align-top text-sm text-ink-soft`}>
            <span className="inline-flex items-center gap-1.5">
              <RowStateDot show={item.needsYou} live={live} />
              {showHold ? needed : when}
            </span>
          </td>
        </>
      ) : null}

      {kind === "job" ? (
        <>
          <td className={`px-5 py-4 align-top ${deskPreviewCellClass}`}>
            <DeskRowHit href={openHref} label="Conversation" />
            <div className={`${deskRowMutedClass} flex items-center gap-3`}>
              <RowIdentity name={item.callerName} />
              <div className="min-w-0">
                <p
                  className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.needsYou)}`}
                >
                  {hasJob ? visit : stamp}
                </p>
              </div>
            </div>
          </td>
          <td className={`${deskRowMutedClass} max-w-[10rem] px-5 py-4 align-top font-medium text-ink`}>
            <p className={deskPreviewClass}>{item.callerName || "Caller"}</p>
          </td>
          <td className={`${deskRowMutedClass} px-5 py-4 align-top text-sm text-ink-soft`}>
            <span className="inline-flex items-center gap-1.5">
              <RowStateDot show={item.needsYou} live={live} />
              {hasJob ? place : ""}
            </span>
          </td>
        </>
      ) : null}

      {kind === "mixed" ? (
        <>
          <td className={`px-5 py-4 align-top ${deskPreviewCellClass}`}>
            <DeskRowHit href={openHref} label="Conversation" />
            <div className={`${deskRowMutedClass} flex items-center gap-3`}>
              <RowIdentity name={item.callerName} />
              <div className="min-w-0">
                <p
                  className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.needsYou)}`}
                >
                  {who}
                </p>
                <p className={`mt-0.5 text-sm text-ink ${deskPreviewClass}`}>{item.headline}</p>
              </div>
            </div>
          </td>
          <td className={`${deskRowMutedClass} px-5 py-4 align-top`}>
            <InboxPurposeChip purpose={item.purpose} label={stamp} />
          </td>
          <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-4 align-top text-sm text-ink-soft`}>
            <span className="inline-flex items-center gap-1.5">
              <RowStateDot show={item.needsYou} live={live} />
              {when}
            </span>
          </td>
        </>
      ) : null}

      <td className={`${deskRowActionClass} whitespace-nowrap px-5 py-4 align-middle`}>
        <div className="flex justify-end">
          <InboxTrailingAction item={item} message={message} />
        </div>
      </td>
    </DeskLandSurface>
  );
}

/** iOS Mail / Material list row. One primary verb. Row body opens the conversation. */
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
  const { who, message, openHref, needed, visit, when, showJob, showHold } =
    inboxCopy(item, purpose, vertical, businessName);
  const work = item.headline;
  const meta = showHold ? needed : showJob ? visit : when;
  const body = (
    <>
      <RowIdentity name={item.callerName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.needsYou)}`}>
            {who}
          </p>
          <p className="flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">
            <RowStateDot show={item.needsYou} live={item.purpose === "live"} />
            {meta}
          </p>
        </div>
        <p className={`mt-0.5 text-sm ${deskPreviewClass} ${item.needsYou ? "text-ink" : "text-ink-soft"}`}>
          {work}
        </p>
      </div>
    </>
  );

  return (
    <DeskLandSurface
      as="li"
      id={item.id}
      className={[
        "relative flex min-w-0 items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0",
        item.urgent ? "bg-warn-soft/50" : "",
      ].join(" ")}
    >
      {openHref ? (
        <Link
          href={openHref}
          aria-label="Conversation"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      <div className={`${deskRowActionClass} flex shrink-0 items-center self-center`}>
        <InboxTrailingAction item={item} message={message} />
      </div>
    </DeskLandSurface>
  );
}

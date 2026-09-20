import type { ReactNode } from "react";
import { CallLink } from "@/components/CallLink";
import { InboxJobActions } from "@/components/InboxJobActions";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { InboxRowAvatar } from "@/components/InboxRowAvatar";
import { InboxRowMore, InboxRowShell } from "@/components/InboxRowOverflow";
import { InboxPhoneOpen, InboxRowCheck, InboxRowHit, InboxDockIdle } from "@/components/InboxRowSelect";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import {
  deskRowActionClass,
  deskRowMutedClass,
} from "@/components/ui/deskRowHit";
import {
  deskPreviewCellClass,
  deskPreviewClass,
  deskShiftClass,
} from "@/components/ui/deskChrome";
import {
  RowStateDot,
  deskRowWeightClass,
} from "@/components/ui/deskRow";
import { followUpWhatsAppMessage, formatCallWhenRelative } from "@/lib/callsTriage";
import { contactFromInboxHref, inboxRecordHref, type InboxReturn } from "@/lib/inboxHref";
import { inboxListDockRecipe, inboxNeedsYouNextStep } from "@/lib/inboxListVerbs";
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
  businessName: string,
  ret?: InboxReturn
) {
  const kind = inboxTableKind(purpose);
  const who = item.callerName || item.callerPhone || "Caller";
  const message = followUpWhatsAppMessage({
    businessName,
    name: item.callerName,
    reason: item.headline,
  });
  const openHref = item.callId
    ? inboxRecordHref(item.callId, ret || { purpose })
    : null;
  const hasJob = Boolean(item.job);
  const hasHold = Boolean(item.hold);
  const needed = item.hold?.when_text?.trim() || "Anytime";
  const visit = item.job?.window_start
    ? formatCallWhenRelative(item.job.window_start)
    : item.job?.when_text?.trim() || "Time TBD";
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
    nextStep: inboxNeedsYouNextStep(item, vertical),
  };
}

function InboxNextStep({ line }: { line: string | null }) {
  if (!line) return null;
  return <p className={`mt-0.5 text-xs text-ink-soft ${deskPreviewClass}`}>{line}</p>;
}

function inboxContactHref(item: InboxItem, purpose: InboxPurposeFilterId, ret?: InboxReturn) {
  return item.contactId ? contactFromInboxHref(item.contactId, ret || { purpose }) : null;
}

function InboxRowWho({
  item,
  purpose,
  ret,
  children,
}: {
  item: InboxItem;
  purpose: InboxPurposeFilterId;
  ret?: InboxReturn;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <InboxRowCheck item={item} />
      <div className={deskRowActionClass}>
        <InboxRowAvatar
          name={item.callerName}
          phone={item.callerPhone}
          contactHref={inboxContactHref(item, purpose, ret)}
          ret={ret}
          itemId={item.id}
        />
      </div>
      <div className={`${deskRowMutedClass} min-w-0`}>{children}</div>
    </div>
  );
}

/**
 * Inbox Action dock. One primary verb. Never Open, View, SMS, or email.
 * Visit requested → Confirm. Confirmed visit → Done. Hold → Done.
 * Return, intent-only, archived + number → Call then WhatsApp.
 * Intent-only never Confirm or Done.
 */
function InboxTrailingAction({
  item,
  message,
}: {
  item: InboxItem;
  message: string;
}) {
  const recipe = inboxListDockRecipe(item);
  if ((recipe === "confirm" || recipe === "visit_done") && item.job) {
    return (
      <InboxDockIdle>
        <InboxJobActions id={item.job.id} status={item.job.status} extra={false} />
      </InboxDockIdle>
    );
  }
  if (recipe === "hold_done" && item.hold) {
    return (
      <InboxDockIdle>
        <RequestStatusToggle id={item.hold.id} status={item.hold.status} extra={false} />
      </InboxDockIdle>
    );
  }
  if (recipe === "call_wa" && item.callerPhone) {
    return (
      <InboxDockIdle>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <CallLink number={item.callerPhone} />
          <WhatsAppLink
            number={item.callerPhone}
            message={message}
            variant="icon"
            callId={item.callId}
          />
        </div>
      </InboxDockIdle>
    );
  }
  return null;
}

export function InboxTableRow({
  item,
  businessName,
  purpose,
  vertical,
  ret,
}: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
  ret?: InboxReturn;
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
    nextStep,
  } = inboxCopy(item, purpose, vertical, businessName, ret);

  const live = item.purpose === "live";

  return (
    <InboxRowShell
      item={item}
      as="tr"
      className={[
        "relative border-t border-line/70",
        deskShiftClass,
        openHref ? "cursor-pointer" : "",
        "hover:bg-accent/[0.04] active:bg-accent/[0.07]",
        item.urgent ? "bg-warn-soft/50" : "",
      ].join(" ")}
    >
      {kind === "hold" ? (
        <>
          <td className={`px-5 py-4 align-top ${deskPreviewCellClass}`}>
            <InboxRowHit href={openHref} label="Conversation" itemId={item.id} />
            <InboxRowWho item={item} purpose={purpose} ret={ret}>
              <p
                className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.unread)} ${item.muted ? "text-ink-soft" : ""}`}
              >
                {item.headline}
              </p>
              <InboxNextStep line={nextStep} />
            </InboxRowWho>
          </td>
          <td className={`${deskRowMutedClass} max-w-[10rem] px-5 py-4 align-top font-medium text-ink`}>
            <p className={deskPreviewClass}>{item.callerName || "Caller"}</p>
          </td>
          <td className={`${deskRowMutedClass} min-w-[6.5rem] px-5 py-4 align-top text-sm text-ink-soft`}>
            <span className="inline-flex min-w-[5.5rem] items-center gap-1.5">
              <RowStateDot show={item.unread} live={live} />
              <span className="min-w-0 truncate">{showHold ? needed : when}</span>
            </span>
          </td>
        </>
      ) : null}

      {kind === "job" ? (
        <>
          <td className={`px-5 py-4 align-top ${deskPreviewCellClass}`}>
            <InboxRowHit href={openHref} label="Conversation" itemId={item.id} />
            <InboxRowWho item={item} purpose={purpose} ret={ret}>
              <p
                className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.unread)} ${item.muted ? "text-ink-soft" : ""}`}
              >
                {hasJob ? visit : stamp}
              </p>
              <InboxNextStep line={nextStep} />
            </InboxRowWho>
          </td>
          <td className={`${deskRowMutedClass} max-w-[10rem] px-5 py-4 align-top font-medium text-ink`}>
            <p className={deskPreviewClass}>{item.callerName || "Caller"}</p>
          </td>
          <td className={`${deskRowMutedClass} min-w-[6.5rem] px-5 py-4 align-top text-sm text-ink-soft`}>
            <span className="inline-flex min-w-[5.5rem] items-center gap-1.5">
              <RowStateDot show={item.unread} live={live} />
              <span className="min-w-0 truncate">{hasJob ? place : ""}</span>
            </span>
          </td>
        </>
      ) : null}

      {kind === "mixed" ? (
        <>
          <td className={`px-5 py-4 align-top ${deskPreviewCellClass}`}>
            <InboxRowHit href={openHref} label="Conversation" itemId={item.id} />
            <InboxRowWho item={item} purpose={purpose} ret={ret}>
              <p
                className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.unread)} ${item.muted ? "text-ink-soft" : ""}`}
              >
                {who}
              </p>
              <p className={`mt-0.5 text-sm text-ink ${deskPreviewClass}`}>{item.headline}</p>
              <InboxNextStep line={nextStep} />
            </InboxRowWho>
          </td>
          <td className={`${deskRowMutedClass} min-w-[7rem] px-5 py-4 align-top`}>
            <InboxPurposeChip purpose={item.purpose} label={stamp} />
          </td>
          <td className={`${deskRowMutedClass} min-w-[6.5rem] whitespace-nowrap px-5 py-4 align-top text-sm text-ink-soft`}>
            <span className="inline-flex min-w-[5.5rem] items-center gap-1.5">
              <RowStateDot show={item.unread} live={live} />
              <span className="min-w-0 truncate">{when}</span>
            </span>
          </td>
        </>
      ) : null}

      <td className={`${deskRowActionClass} whitespace-nowrap px-5 py-4 align-middle`}>
        <div className="flex items-center justify-end gap-1">
          <InboxRowMore item={item} />
          <InboxTrailingAction item={item} message={message} />
        </div>
      </td>
    </InboxRowShell>
  );
}

/** iOS Mail / Material list row. One primary verb. Row body opens the conversation. */
export function InboxPhoneRow({
  item,
  businessName,
  purpose,
  vertical,
  ret,
}: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
  ret?: InboxReturn;
}) {
  const { who, message, openHref, needed, visit, when, showJob, showHold, nextStep } =
    inboxCopy(item, purpose, vertical, businessName, ret);
  const work = item.headline;
  const meta = showHold ? needed : showJob ? visit : when;
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(item.unread)}`}>
          {who}
        </p>
        <p className="flex min-w-[5.5rem] shrink-0 items-center justify-end gap-1.5 text-xs text-ink-soft">
          <RowStateDot show={item.unread} live={item.purpose === "live"} />
          <span className="max-w-[7.5rem] truncate">{meta}</span>
        </p>
      </div>
      <p className={`mt-0.5 text-sm ${deskPreviewClass} ${item.needsYou ? "text-ink" : "text-ink-soft"}`}>
        {work}
      </p>
      <InboxNextStep line={nextStep} />
    </div>
  );

  return (
    <InboxRowShell
      item={item}
      as="li"
      className={[
        "relative flex min-w-0 items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0",
        item.urgent ? "bg-warn-soft/50" : "",
      ].join(" ")}
    >
      <InboxRowCheck item={item} />
      <div className={deskRowActionClass}>
        <InboxRowAvatar
          name={item.callerName}
          phone={item.callerPhone}
          contactHref={inboxContactHref(item, purpose, ret)}
          ret={ret}
          itemId={item.id}
        />
      </div>
      <InboxPhoneOpen href={openHref} itemId={item.id}>
        {body}
      </InboxPhoneOpen>
      <div className={`${deskRowActionClass} flex shrink-0 items-center self-center gap-1`}>
        <InboxRowMore item={item} />
        <InboxTrailingAction item={item} message={message} />
      </div>
    </InboxRowShell>
  );
}

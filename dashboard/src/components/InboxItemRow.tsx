"use client";

import { PhoneIcon } from "@heroicons/react/24/outline";
import { useInboxRowLocal, useInboxRowUi } from "@/components/InboxRowUi";
import { InboxJobActions } from "@/components/InboxJobActions";
import { inboxStampTone } from "@/components/InboxPurposeChip";
import { InboxRowAvatar } from "@/components/InboxRowAvatar";
import { InboxRowMore, InboxRowShell } from "@/components/InboxRowOverflow";
import { InboxRowCheck, InboxDockIdle } from "@/components/InboxRowSelect";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { telHref } from "@/components/CallLink";
import { waMeHref } from "@/components/WhatsAppLink";
import { logWhatsAppFollowUp } from "@/app/(desk)/calls/actions";
import { IconButtonAnchor } from "@/components/ui/IconButton";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import { deskPreviewClass, deskShiftClass } from "@/components/ui/deskChrome";
import { InboxPinMark } from "@/components/ui/deskRow";
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
  const stamp = itemSignalLabel(item, vertical);
  const when = formatCallWhenRelative(item.createdAt);
  const showJob = kind === "job" && hasJob;
  const showHold = kind === "hold" && hasHold;
  return {
    who,
    message,
    openHref,
    needed,
    visit,
    stamp,
    when,
    showJob,
    showHold,
    nextStep: inboxNeedsYouNextStep(item, vertical),
  };
}

function InboxWhenMeta({ item, text }: { item: InboxItem; text: string }) {
  const [local] = useInboxRowLocal(item.id);
  const pinnedAt = local.pinnedAt === undefined ? item.pinnedAt : local.pinnedAt;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <InboxPinMark show={Boolean(pinnedAt)} />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

function inboxContactHref(item: InboxItem, purpose: InboxPurposeFilterId, ret?: InboxReturn) {
  return item.contactId ? contactFromInboxHref(item.contactId, ret || { purpose }) : null;
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.33 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.73 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
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
    const tel = telHref(item.callerPhone);
    const wa = waMeHref(item.callerPhone, message);
    return (
      <InboxDockIdle>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {tel ? (
            <IconButtonAnchor href={tel} label={`Call ${item.callerPhone}`} tone="accent">
              <PhoneIcon aria-hidden="true" />
            </IconButtonAnchor>
          ) : null}
          {wa ? (
            <IconButtonAnchor
              href={wa}
              target="_blank"
              rel="noreferrer"
              label={`WhatsApp ${item.callerPhone}`}
              tone="whatsapp"
              onClick={() => {
                if (item.callId) void logWhatsAppFollowUp(item.callId);
              }}
            >
              <WhatsAppGlyph />
            </IconButtonAnchor>
          ) : null}
        </div>
      </InboxDockIdle>
    );
  }
  return null;
}

function InboxListRow({
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
  const ui = useInboxRowUi();
  const { who, message, openHref, needed, visit, stamp, when, showJob, showHold, nextStep } =
    inboxCopy(item, purpose, vertical, businessName, ret);
  const selecting = Boolean(ui?.selecting);
  const selected = Boolean(ui?.selected.includes(item.id));
  const whenText = showHold ? needed : showJob ? visit : when;
  const glance = nextStep || stamp;

  return (
    <InboxRowShell item={item} as="li">
      <ListRow
        as="div"
        className={`w-full ${deskShiftClass}`}
        aside={
          <>
            <InboxRowCheck item={item} />
            <InboxRowAvatar
              name={item.callerName}
              phone={item.callerPhone}
              contactHref={inboxContactHref(item, purpose, ret)}
              ret={ret}
              itemId={item.id}
            />
          </>
        }
        href={!selecting && openHref ? openHref : undefined}
        onOpen={selecting ? () => ui?.toggle(item.id) : undefined}
        ariaLabel="Conversation"
        unread={item.unread || item.purpose === "live"}
        selected={selected}
        title={who}
        preview={<span className={deskPreviewClass}>{item.headline}</span>}
        when={<InboxWhenMeta item={item} text={whenText} />}
        stamp={
          <Stamp tone={item.purpose === "live" ? "live" : inboxStampTone(item.purpose, glance)}>
            {glance}
          </Stamp>
        }
        actions={
          <>
            <InboxRowMore item={item} />
            <InboxTrailingAction item={item} message={message} />
          </>
        }
      />
    </InboxRowShell>
  );
}

/** One row at every width. Phone and desktop share this list. */
export function InboxPhoneRow(props: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
  ret?: InboxReturn;
}) {
  return <InboxListRow {...props} />;
}

/** Same row as the phone list. Kept so older call sites keep compiling. */
export function InboxTableRow(props: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
  ret?: InboxReturn;
}) {
  return <InboxListRow {...props} />;
}

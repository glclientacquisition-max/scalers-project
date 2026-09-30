import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { ContactNameForm } from "@/components/ContactNameForm";
import { DeskLandSurface } from "@/components/ui/DeskLand";
import { RowIdentity, deskRowWeightClass } from "@/components/ui/deskRow";
import {
  DeskRowHit,
  deskRowActionClass,
  deskRowMutedClass,
} from "@/components/ui/deskRowHit";
import { deskPreviewClass } from "@/components/ui/deskChrome";
import { formatCallWhenRelative } from "@/lib/callsTriage";
import {
  contactListSubline,
  contactListTitle,
  isUnsavedContactName,
  type ContactListRow as ContactListRowData,
} from "@/lib/contactsLoad";

function ContactListDock({ phone }: { phone: string | null }) {
  const number = String(phone || "").trim();
  if (!number) return null;
  return (
    <div className={`${deskRowActionClass} flex shrink-0 items-center self-center justify-end gap-2`}>
      <CallLink number={number} />
      <WhatsAppLink number={number} variant="icon" />
    </div>
  );
}

function lastCallStamp(row: ContactListRowData): string | null {
  return row.lastContactAt ? formatCallWhenRelative(row.lastContactAt) : null;
}

/**
 * One row at every width. Shell matches InboxPhoneRow
 * (`gap-3`, `border-t border-line/70`, `px-4 py-3`). No unread dot, no select.
 */
export function ContactPhoneRow({
  row,
  href,
}: {
  row: ContactListRowData;
  href: string;
}) {
  const title = contactListTitle(row);
  const subline = contactListSubline(row);
  const lastCall = lastCallStamp(row);
  const unsaved = isUnsavedContactName(row.name);
  return (
    <DeskLandSurface
      as="li"
      id={row.id}
      className="relative flex min-w-0 items-center gap-3 overflow-hidden border-t border-line/70 px-4 py-3 first:border-t-0"
    >
      <DeskRowHit href={href} label={title} />
      <div className={deskRowMutedClass}>
        <RowIdentity name={row.name} />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className={deskRowMutedClass}>
          <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <p
              className={`min-w-0 sm:flex-1 text-sm tracking-tight ${deskPreviewClass} ${deskRowWeightClass(false)}`}
            >
              {title}
            </p>
            {lastCall ? (
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft sm:max-w-[45%] sm:shrink-0 sm:justify-end">
                <span className="min-w-0 truncate">{lastCall}</span>
              </p>
            ) : null}
          </div>
          <p className={`mt-0.5 text-sm text-ink-soft ${deskPreviewClass}`}>{subline}</p>
        </div>
        {unsaved ? (
          <div className={`${deskRowActionClass} mt-1`}>
            <ContactNameForm contactId={row.id} initialName={row.name} variant="row" />
          </div>
        ) : null}
      </div>
      <ContactListDock phone={row.phone} />
    </DeskLandSurface>
  );
}

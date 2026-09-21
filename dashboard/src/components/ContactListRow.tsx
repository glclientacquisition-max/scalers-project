import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DeskLandSurface } from "@/components/ui/DeskLand";
import { RowIdentity } from "@/components/ui/deskRow";
import {
  DeskRowHit,
  deskRowActionClass,
  deskRowMutedClass,
} from "@/components/ui/deskRowHit";
import {
  deskPreviewCellClass,
  deskPreviewClass,
  deskShiftClass,
} from "@/components/ui/deskChrome";
import { formatCallWhenRelative } from "@/lib/callsTriage";
import {
  contactListSubline,
  type ContactListRow as ContactListRowData,
} from "@/lib/contactsLoad";

function ContactListDock({ phone }: { phone: string | null }) {
  const number = String(phone || "").trim();
  if (!number) return null;
  return (
    <div className={`${deskRowActionClass} flex shrink-0 items-center justify-end gap-2`}>
      <CallLink number={number} />
      <WhatsAppLink number={number} variant="icon" />
    </div>
  );
}

function contactTitle(row: ContactListRowData): string {
  return row.name?.trim() || "Unknown";
}

function lastCallStamp(row: ContactListRowData): string | null {
  return row.lastContactAt ? formatCallWhenRelative(row.lastContactAt) : null;
}

export function ContactPhoneRow({ row }: { row: ContactListRowData }) {
  const title = contactTitle(row);
  const subline = contactListSubline(row);
  const lastCall = lastCallStamp(row);
  return (
    <DeskLandSurface
      as="li"
      id={row.id}
      className="relative flex min-h-16 min-w-0 items-center gap-2 border-t border-line/70 px-3 py-3 first:border-t-0 sm:gap-3 sm:px-4"
    >
      <DeskRowHit href={`/contacts/${row.id}`} label={title} />
      <div className={deskRowMutedClass}>
        <RowIdentity name={row.name} />
      </div>
      <div className={`${deskRowMutedClass} min-w-0 flex-1`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className={`min-w-0 text-base font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
            {title}
          </p>
          {lastCall ? (
            <p className="max-w-[7.5rem] shrink-0 truncate text-xs tabular-nums text-ink-soft">
              {lastCall}
            </p>
          ) : null}
        </div>
        <p className={`mt-0.5 text-sm text-ink-soft ${deskPreviewClass}`}>{subline}</p>
      </div>
      <ContactListDock phone={row.phone} />
    </DeskLandSurface>
  );
}

export function ContactTableRow({ row }: { row: ContactListRowData }) {
  const title = contactTitle(row);
  const subline = contactListSubline(row);
  const lastCall = lastCallStamp(row);
  return (
    <DeskLandSurface
      as="tr"
      id={row.id}
      className={`group relative cursor-pointer border-t border-line/70 ${deskShiftClass} hover:bg-accent/[0.04]`}
    >
      <td className="px-3 py-3.5 align-top lg:px-5 lg:py-5">
        <DeskRowHit href={`/contacts/${row.id}`} label={title} />
        <div className={`${deskRowMutedClass} flex min-w-0 items-center gap-3`}>
          <RowIdentity name={row.name} />
          <div className="min-w-0">
            <p className={`text-base font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
              {title}
            </p>
            <p className={`mt-0.5 text-sm text-ink-soft lg:hidden ${deskPreviewClass}`}>
              {subline}
            </p>
          </div>
        </div>
      </td>
      <td
        className={`${deskRowMutedClass} hidden px-3 py-3.5 align-top font-mono text-sm text-ink lg:table-cell lg:px-5 lg:py-5`}
      >
        {row.phone || "No phone"}
      </td>
      <td className={`${deskRowMutedClass} ${deskPreviewCellClass} px-3 py-3.5 align-top text-sm text-ink-soft lg:px-5 lg:py-5`}>
        <p className={`tabular-nums ${deskPreviewClass}`}>{lastCall || "None"}</p>
      </td>
      <td className="w-px px-3 py-3.5 align-middle lg:px-5 lg:py-5">
        <ContactListDock phone={row.phone} />
      </td>
    </DeskLandSurface>
  );
}

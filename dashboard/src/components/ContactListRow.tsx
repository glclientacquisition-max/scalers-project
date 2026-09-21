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
import type { ContactListRow as ContactListRowData } from "@/lib/contactsLoad";

function ContactListDock({ phone }: { phone: string | null }) {
  if (!String(phone || "").trim()) return null;
  return (
    <div className={`${deskRowActionClass} flex shrink-0 items-center justify-end gap-2`}>
      <CallLink number={phone} />
      <WhatsAppLink number={phone} variant="icon" />
    </div>
  );
}

function contactTitle(row: ContactListRowData): string {
  return row.name?.trim() || "Unknown";
}

export function ContactPhoneRow({ row }: { row: ContactListRowData }) {
  const title = contactTitle(row);
  return (
    <DeskLandSurface
      as="li"
      id={row.id}
      className="relative flex min-w-0 items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0"
    >
      <DeskRowHit href={`/contacts/${row.id}`} label={title} />
      <div className={deskRowMutedClass}>
        <RowIdentity name={row.name} />
      </div>
      <div className={`${deskRowMutedClass} min-w-0 flex-1`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className={`min-w-0 text-base font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
            {title}
          </p>
          {row.lastContactAt ? (
            <p className="shrink-0 text-xs text-ink-soft">
              {formatCallWhenRelative(row.lastContactAt)}
            </p>
          ) : null}
        </div>
        <p className={`mt-0.5 text-sm text-ink-soft ${deskPreviewClass}`}>
          {row.lastReasonDisplay || "None"}
        </p>
      </div>
      <ContactListDock phone={row.phone} />
    </DeskLandSurface>
  );
}

export function ContactTableRow({ row }: { row: ContactListRowData }) {
  const title = contactTitle(row);
  return (
    <DeskLandSurface
      as="tr"
      id={row.id}
      className={`group relative cursor-pointer border-t border-line/70 ${deskShiftClass} hover:bg-accent/[0.04]`}
    >
      <td className="px-5 py-5 align-top">
        <DeskRowHit href={`/contacts/${row.id}`} label={title} />
        <div className={`${deskRowMutedClass} flex items-center gap-3`}>
          <RowIdentity name={row.name} />
          <p className={`min-w-0 text-base font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
            {title}
          </p>
        </div>
      </td>
      <td className={`${deskRowMutedClass} px-5 py-5 align-top font-mono text-sm text-ink`}>
        {row.phone || "No phone"}
      </td>
      <td className={`${deskRowMutedClass} ${deskPreviewCellClass} px-5 py-5 align-top text-sm text-ink-soft`}>
        <p className={deskPreviewClass}>{row.lastReasonDisplay || "None"}</p>
      </td>
      <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-5 align-top text-sm text-ink-soft`}>
        {row.lastContactAt ? formatCallWhenRelative(row.lastContactAt) : "None"}
      </td>
      <td className="px-5 py-5 align-middle">
        <ContactListDock phone={row.phone} />
      </td>
    </DeskLandSurface>
  );
}

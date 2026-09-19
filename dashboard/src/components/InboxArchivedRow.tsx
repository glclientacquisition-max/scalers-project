import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewClass, deskShiftClass } from "@/components/ui/deskChrome";
import { inboxArchivedHref, type InboxReturn } from "@/lib/inboxHref";

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 7h16M6 7l1 12h10l1-12M9 7V5h6v2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArchiveMark() {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-soft"
    >
      <ArchiveGlyph />
    </span>
  );
}

export function InboxArchivedPhoneRow({
  count,
  ret,
}: {
  count: number;
  ret?: InboxReturn;
}) {
  return (
    <li
      className={[
        "relative flex min-w-0 items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0",
        deskShiftClass,
        "hover:bg-accent/[0.04] active:bg-accent/[0.07]",
      ].join(" ")}
    >
      <DeskRowHit href={inboxArchivedHref(ret)} label="Archived" />
      <div className={deskRowMutedClass}>
        <ArchiveMark />
      </div>
      <div className={`${deskRowMutedClass} min-w-0 flex-1`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className={`text-sm font-medium tracking-tight ${deskPreviewClass}`}>Archived</p>
          <p className="shrink-0 text-xs text-ink-soft">{count}</p>
        </div>
      </div>
    </li>
  );
}

export function InboxArchivedTableRow({
  count,
  ret,
}: {
  count: number;
  ret?: InboxReturn;
}) {
  return (
    <tr
      className={[
        "relative border-t border-line/70",
        deskShiftClass,
        "hover:bg-accent/[0.04] active:bg-accent/[0.07]",
      ].join(" ")}
    >
      <td colSpan={4} className="px-5 py-4">
        <DeskRowHit href={inboxArchivedHref(ret)} label="Archived" />
        <div className="flex items-center gap-3">
          <div className={deskRowMutedClass}>
            <ArchiveMark />
          </div>
          <p className={`${deskRowMutedClass} min-w-0 text-sm font-medium tracking-tight ${deskPreviewClass}`}>
            Archived
          </p>
          <p className={`${deskRowMutedClass} ml-auto shrink-0 text-sm text-ink-soft`}>{count}</p>
        </div>
      </td>
    </tr>
  );
}

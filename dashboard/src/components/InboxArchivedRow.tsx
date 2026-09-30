import { ListRow } from "@/components/ui/ListRow";
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
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-soft"
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
    <ListRow
      href={inboxArchivedHref(ret)}
      ariaLabel="Archived"
      className="min-h-12"
      leading={<ArchiveMark />}
      title="Archived"
      when={<span className="tabular-nums">{count}</span>}
    />
  );
}

/** Same archived row. The pile no longer has a separate table. */
export function InboxArchivedTableRow({
  count,
  ret,
}: {
  count: number;
  ret?: InboxReturn;
}) {
  return <InboxArchivedPhoneRow count={count} ret={ret} />;
}

import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewClass, deskShiftClass } from "@/components/ui/deskChrome";

function RecentGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 7.5v5l3 1.75M12 4a8 8 0 1 0 8 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UnsavedGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 18.5c.9-2.8 3.2-4.3 6.5-4.3s5.6 1.5 6.5 4.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QuickMark({ kind }: { kind: "recent" | "unsaved" }) {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-soft"
    >
      {kind === "recent" ? <RecentGlyph /> : <UnsavedGlyph />}
    </span>
  );
}

export function ContactQuickPhoneRow({
  kind,
  href,
}: {
  kind: "recent" | "unsaved";
  href: string;
}) {
  const label = kind === "recent" ? "Recent calls" : "Unsaved";
  return (
    <li
      className={[
        "relative flex min-h-12 min-w-0 items-center gap-3 border-t border-line/70 px-4 py-3 first:border-t-0",
        deskShiftClass,
        "hover:bg-accent/[0.04] active:bg-accent/[0.07]",
      ].join(" ")}
    >
      <DeskRowHit href={href} label={label} />
      <div className={deskRowMutedClass}>
        <QuickMark kind={kind} />
      </div>
      <p
        className={`${deskRowMutedClass} min-w-0 flex-1 text-sm font-medium tracking-tight ${deskPreviewClass}`}
      >
        {label}
      </p>
    </li>
  );
}

export function ContactQuickTableRow({
  kind,
  href,
  colSpan,
}: {
  kind: "recent" | "unsaved";
  href: string;
  colSpan: number;
}) {
  const label = kind === "recent" ? "Recent calls" : "Unsaved";
  return (
    <tr
      className={[
        "relative border-t border-line/70",
        deskShiftClass,
        "hover:bg-accent/[0.04] active:bg-accent/[0.07]",
      ].join(" ")}
    >
      <td colSpan={colSpan} className="relative min-h-12 px-5 py-4">
        <DeskRowHit href={href} label={label} />
        <div className="flex items-center gap-3">
          <div className={deskRowMutedClass}>
            <QuickMark kind={kind} />
          </div>
          <p
            className={`${deskRowMutedClass} min-w-0 text-sm font-medium tracking-tight ${deskPreviewClass}`}
          >
            {label}
          </p>
        </div>
      </td>
    </tr>
  );
}

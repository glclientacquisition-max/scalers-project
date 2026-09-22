import { RowIdentity } from "@/components/ui/deskRow";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { deskPreviewClass } from "@/components/ui/deskChrome";
import { contactStripTitle } from "@/lib/contactStrip";
import { contactListSubline } from "@/lib/contactsLoad";
import { sanitizeStoredCallerName } from "@/lib/callerNameQuality";

export function ContactStrip({
  name,
  phone,
  lastContactAt,
  profileHref,
}: {
  name: string | null;
  phone: string | null;
  lastContactAt: string | null;
  profileHref: string | null;
}) {
  const title = contactStripTitle(name, Boolean(profileHref));
  const fact = contactListSubline({ name, phone, lastContactAt });
  const avatarName = sanitizeStoredCallerName(name);

  return (
    <div
      data-contact-strip=""
      className="relative flex min-h-12 min-w-0 flex-1 items-center gap-2 sm:gap-3"
    >
      <DeskRowHit href={profileHref} label={title} />
      <div className={deskRowMutedClass}>
        <RowIdentity name={avatarName} />
      </div>
      <div className={`${deskRowMutedClass} min-w-0 flex-1`}>
        <p className={`text-sm font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
          {title}
        </p>
        <p className={`mt-0.5 text-sm text-ink-soft ${deskPreviewClass}`}>{fact}</p>
      </div>
    </div>
  );
}

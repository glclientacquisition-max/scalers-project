import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { RowIdentity } from "@/components/ui/deskRow";
import {
  DeskRowHit,
  deskRowActionClass,
  deskRowMutedClass,
} from "@/components/ui/deskRowHit";
import { deskPreviewClass } from "@/components/ui/deskChrome";
import { contactStripFact, contactStripTitle } from "@/lib/contactStrip";
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
  const fact = contactStripFact({ name, phone, lastContactAt });
  const avatarName = sanitizeStoredCallerName(name);
  const number = String(phone || "").trim();

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
      {number ? (
        <div
          data-contact-strip-reach=""
          className={`${deskRowActionClass} flex shrink-0 items-center justify-end gap-2`}
        >
          <CallLink number={number} />
          <WhatsAppLink number={number} variant="icon" />
        </div>
      ) : null}
    </div>
  );
}

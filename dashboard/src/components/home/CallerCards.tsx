import Link from "next/link";
import { PhoneIcon } from "@heroicons/react/24/outline";
import { StatusMark } from "@/components/ui/StatusMark";
import { IconButtonLink } from "@/components/ui/IconButton";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { callsHref, formatCallWhenRelative } from "@/lib/callsTriage";
import { inboxRecordHref } from "@/lib/inboxHref";
import { callerChip, callerDisplayName, callerInitials, pickCallerCards } from "@/lib/callerCards";
import type { InboxItem } from "@/lib/inboxPurpose";

const TIME = new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
const DAY = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

function clock(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? TIME.format(t) : "";
}

/** Up to three caller cards. One Call button. See all opens Inbox. */
export function CallerCards({
  items,
  dayStart,
  pinId,
  lineLive,
  factsFailed,
}: {
  items: InboxItem[];
  dayStart: string;
  pinId: string | null;
  lineLive: boolean;
  factsFailed: boolean;
}) {
  const { latest, cards } = pickCallerCards(items, dayStart, pinId);
  const day = cards[0] ? DAY.format(new Date(cards[0].createdAt)) : "";
  return (
    <section aria-label={latest ? "Latest callers" : "Callers"} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-title text-ink">{latest ? "Latest" : "Callers"}</h2>
        {latest && day ? <p className="text-meta text-ink-2">{day}</p> : null}
        {cards.length > 0 ? (
          <Link href={callsHref({ purpose: "all" })} className={`text-body font-medium text-accent ${focusRingVisible}`}>
            See all
          </Link>
        ) : null}
      </div>
      {factsFailed ? <p role="alert" className="mt-2 text-body text-attention">Could not load outcomes for today.</p> : null}
      {cards.length === 0 && lineLive && !factsFailed ? <p className="mt-3 text-body text-ink-2">No calls yet today.</p> : null}
      {cards.length > 0 ? (
        <ul className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-surface">
          {cards.map((item, index) => (
            <CallerCard key={item.id} item={item} index={index} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CallerCard({ item, index }: { item: InboxItem; index: number }) {
  const name = callerDisplayName(item);
  const chip = callerChip(item);
  const href = item.callId ? inboxRecordHref(item.callId, { from: "home" }) : null;
  const phone = item.callerPhone?.trim() || "";
  const redials = item.redials?.length ?? 0;
  const when = formatCallWhenRelative(item.createdAt);
  return (
    <li
      className="relative border-t border-hairline first:border-t-0 motion-enter"
      style={{ animationDelay: `${Math.min(index, 4) * 30}ms` }}
    >
      {href ? <Link href={href} className={`absolute inset-0 z-0 ${focusRingVisible}`} aria-label={name} /> : null}
      <div className="flex min-h-[4.75rem] items-center gap-3 px-3 py-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-meta font-semibold text-ink" aria-hidden="true">
          {callerInitials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`min-w-0 truncate text-body text-ink ${item.unread ? "font-semibold" : ""}`}>{name}</span>
            <span className="shrink-0 tabular-nums text-meta text-ink-2">{clock(item.createdAt) || when}</span>
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2">
            <StatusMark tone={chip.tone}>{chip.word}</StatusMark>
            {redials > 1 ? <StatusMark tone="danger">{`x${redials}`}</StatusMark> : null}
            <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{item.headline}</span>
          </span>
        </span>
        {phone ? (
          <span className="relative z-10 shrink-0">
            <IconButtonLink href={`tel:${phone}`} label="Call" tone="accent">
              <PhoneIcon />
            </IconButtonLink>
          </span>
        ) : null}
      </div>
    </li>
  );
}

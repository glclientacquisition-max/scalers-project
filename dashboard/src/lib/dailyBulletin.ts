export type BulletinItem = {
  id: string;
  text: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
};

export type BulletinExpiry = "today" | "tomorrow" | "manual" | "schedule";

const MAX_ACTIVE = 5;
const MAX_TEXT = 160;

export function normalizeBulletin(raw: unknown): BulletinItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, index) => {
      const r = (row || {}) as Record<string, unknown>;
      const text = String(r.text || "").trim();
      if (!text) return null;
      return {
        id: String(r.id || `item-${index}`),
        text: text.slice(0, MAX_TEXT),
        active: r.active !== false,
        starts_at: r.starts_at ? String(r.starts_at) : null,
        ends_at: r.ends_at ? String(r.ends_at) : null,
        created_at: r.created_at ? String(r.created_at) : null,
      };
    })
    .filter((row): row is BulletinItem => Boolean(row));
}

/** Calendar Y-M-D in Africa/Nairobi. */
function eatYmd(from = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(from);
  const num = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value || 0);
  return { y: num("year"), m: num("month"), d: num("day") };
}

/** End of calendar day in Africa/Nairobi as ISO instant. */
export function endOfEatDay(from = new Date(), dayOffset = 0): string {
  const { y, m, d } = eatYmd(from);
  const base = new Date(Date.UTC(y, m - 1, d + dayOffset, 20, 59, 59, 999));
  // 23:59:59.999 EAT == 20:59:59.999 UTC on the same Nairobi calendar date.
  return base.toISOString();
}

export function startOfEatNow(from = new Date()): string {
  return from.toISOString();
}

const EAT_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `datetime-local` value in Africa/Nairobi. */
export function eatDateTimeLocal(from = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(from);
  const num = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";
  return `${num("year")}-${num("month")}-${num("day")}T${num("hour")}:${num("minute")}`;
}

/** Read a Nairobi `datetime-local` as an instant. */
export function parseEatDateTimeLocal(raw: string): Date | null {
  const match = EAT_LOCAL.exec(String(raw || "").trim());
  if (!match) return null;
  const instant = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+03:00`
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function isBulletinEnded(item: BulletinItem, now = new Date()): boolean {
  if (!item.ends_at) return false;
  const end = new Date(item.ends_at);
  return !Number.isNaN(end.getTime()) && now > end;
}

export function isBulletinScheduled(item: BulletinItem, now = new Date()): boolean {
  if (!item.starts_at) return false;
  const start = new Date(item.starts_at);
  return !Number.isNaN(start.getTime()) && now < start;
}

export function isBulletinLive(item: BulletinItem, now = new Date()): boolean {
  if (!item.active) return false;
  if (isBulletinScheduled(item, now)) return false;
  if (isBulletinEnded(item, now)) return false;
  return true;
}

export function liveBulletinItems(
  raw: unknown,
  now = new Date()
): BulletinItem[] {
  return normalizeBulletin(raw).filter((item) => isBulletinLive(item, now));
}

/** Desk list: live plus not-yet-started. Ended and cleared stay off. */
export function deskBulletinItems(
  raw: unknown,
  now = new Date()
): BulletinItem[] {
  return normalizeBulletin(raw).filter(
    (item) => item.active && !isBulletinEnded(item, now)
  );
}

export function formatBulletinEndLabel(
  endsAt: string | null,
  now = new Date()
): string {
  if (!endsAt) return "Until cleared";
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return "Until cleared";

  const eatEndMs = end.getTime() + 3 * 60 * 60 * 1000;
  const eatNowMs = now.getTime() + 3 * 60 * 60 * 1000;
  const eatEnd = new Date(eatEndMs);
  const eatNow = new Date(eatNowMs);
  const sameDay =
    eatEnd.getUTCFullYear() === eatNow.getUTCFullYear() &&
    eatEnd.getUTCMonth() === eatNow.getUTCMonth() &&
    eatEnd.getUTCDate() === eatNow.getUTCDate();

  if (sameDay && eatEnd.getUTCHours() >= 23) return "Until tonight";

  const tomorrow = new Date(eatNowMs);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const isTomorrow =
    eatEnd.getUTCFullYear() === tomorrow.getUTCFullYear() &&
    eatEnd.getUTCMonth() === tomorrow.getUTCMonth() &&
    eatEnd.getUTCDate() === tomorrow.getUTCDate() &&
    eatEnd.getUTCHours() >= 23;

  if (isTomorrow) return "Until tomorrow night";

  return `Until ${eatEnd.toLocaleDateString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })}`;
}

export function resolveExpiryEndsAt(
  expiry: BulletinExpiry,
  now = new Date()
): string | null {
  if (expiry === "manual" || expiry === "schedule") return null;
  if (expiry === "tomorrow") return endOfEatDay(now, 1);
  return endOfEatDay(now, 0);
}

export function resolveBulletinWindow(opts: {
  expiry: BulletinExpiry;
  startsLocal?: string;
  endsLocal?: string;
  now?: Date;
}):
  | { ok: true; starts_at: string; ends_at: string | null }
  | { ok: false; error: string } {
  const now = opts.now || new Date();
  if (opts.expiry !== "schedule") {
    return {
      ok: true,
      starts_at: startOfEatNow(now),
      ends_at: resolveExpiryEndsAt(opts.expiry, now),
    };
  }

  const startsLocal = String(opts.startsLocal || "").trim();
  const endsLocal = String(opts.endsLocal || "").trim();
  const start = startsLocal ? parseEatDateTimeLocal(startsLocal) : now;
  if (startsLocal && !start) return { ok: false, error: "Set a valid start." };
  const end = endsLocal ? parseEatDateTimeLocal(endsLocal) : null;
  if (endsLocal && !end) return { ok: false, error: "Set a valid end." };
  if (end && start && start >= end) {
    return { ok: false, error: "End must be after start." };
  }
  return {
    ok: true,
    starts_at: (start || now).toISOString(),
    ends_at: end ? end.toISOString() : null,
  };
}

function formatEatStamp(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return instant.toLocaleString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

export function formatBulletinWindowLabel(
  item: BulletinItem,
  now = new Date()
): string {
  const endLabel = formatBulletinEndLabel(item.ends_at, now);
  if (isBulletinScheduled(item, now) && item.starts_at) {
    const start = formatEatStamp(item.starts_at);
    return start ? `Starts ${start}. ${endLabel}` : endLabel;
  }
  return endLabel;
}

export function canPostBulletin(
  existing: BulletinItem[],
  now = new Date()
): { ok: true } | { ok: false; error: string } {
  const live = deskBulletinItems(existing, now);
  if (live.length >= MAX_ACTIVE) {
    return {
      ok: false,
      error: `You can have up to ${MAX_ACTIVE} live updates. Clear one first.`,
    };
  }
  return { ok: true };
}

export function validateBulletinText(
  text: string
): { ok: true; text: string } | { ok: false; error: string } {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false, error: "Write a short update first." };
  if (trimmed.length > MAX_TEXT) {
    return { ok: false, error: `Keep it under ${MAX_TEXT} characters.` };
  }
  return { ok: true, text: trimmed };
}

export { MAX_ACTIVE, MAX_TEXT };

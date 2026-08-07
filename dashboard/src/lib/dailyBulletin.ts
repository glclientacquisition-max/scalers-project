export type BulletinItem = {
  id: string;
  text: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
};

export type BulletinExpiry = "today" | "tomorrow" | "manual";

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

export function isBulletinLive(item: BulletinItem, now = new Date()): boolean {
  if (!item.active) return false;
  if (item.starts_at) {
    const start = new Date(item.starts_at);
    if (!Number.isNaN(start.getTime()) && now < start) return false;
  }
  if (item.ends_at) {
    const end = new Date(item.ends_at);
    if (!Number.isNaN(end.getTime()) && now > end) return false;
  }
  return true;
}

export function liveBulletinItems(
  raw: unknown,
  now = new Date()
): BulletinItem[] {
  return normalizeBulletin(raw).filter((item) => isBulletinLive(item, now));
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
  if (expiry === "manual") return null;
  if (expiry === "tomorrow") return endOfEatDay(now, 1);
  return endOfEatDay(now, 0);
}

export function canPostBulletin(
  existing: BulletinItem[],
  now = new Date()
): { ok: true } | { ok: false; error: string } {
  const live = liveBulletinItems(existing, now);
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

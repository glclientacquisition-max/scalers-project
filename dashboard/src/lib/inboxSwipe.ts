/** Touch-swipe Inbox piles. Chips stay the map. Archived is not a stop. */

export const SWIPE_PILES = [
  "needs",
  "all",
  "job",
  "hold",
  "human",
  "answered",
] as const;

export type SwipePileId = (typeof SWIPE_PILES)[number];

/** Clear horizontal intent. Vertical scroll stays primary below this. */
export const INBOX_SWIPE_PX = 64;

export function nextPurpose(current: string): SwipePileId | null {
  if (current === "archived") return null;
  const i = (SWIPE_PILES as readonly string[]).indexOf(current);
  if (i < 0) return null;
  return SWIPE_PILES[i + 1] ?? null;
}

export function prevPurpose(current: string): SwipePileId | null {
  if (current === "archived") return null;
  const i = (SWIPE_PILES as readonly string[]).indexOf(current);
  if (i <= 0) return null;
  return SWIPE_PILES[i - 1] ?? null;
}

export function swipePileCommit(opts: {
  dx: number;
  dy: number;
  pointerType: string;
  selecting?: boolean;
}): "next" | "prev" | null {
  if (opts.selecting) return null;
  if (opts.pointerType !== "touch") return null;
  const dx = opts.dx;
  const dy = opts.dy;
  if (Math.abs(dx) < INBOX_SWIPE_PX) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? "next" : "prev";
}

export function purposeAfterSwipe(
  current: string,
  commit: "next" | "prev" | null
): SwipePileId | null {
  if (commit === "next") return nextPurpose(current);
  if (commit === "prev") return prevPurpose(current);
  return null;
}

/** Same query as tapping a purpose chip (`callsHref` + current List/Work). */
export function inboxPileHref(
  id: string,
  opts: {
    q?: string;
    active: string;
    view?: string;
    week?: string;
    day?: string;
  }
): string {
  const weekView = opts.active === "job" && opts.view === "week";
  const todayView = opts.active === "job" && (opts.view === "today" || opts.view === "work");
  const holdToday = opts.active === "hold" && (opts.view === "today" || opts.view === "work");
  const workView = weekView || todayView;
  const q = new URLSearchParams();
  q.set("purpose", id);
  const text = String(opts.q || "").trim();
  if (text) q.set("q", text);
  const view =
    id === "job" && workView
      ? weekView
        ? "week"
        : "today"
      : id === "hold" && holdToday
        ? "today"
        : undefined;
  if (view) q.set("view", view);
  if (id === "job" && weekView && opts.week) q.set("week", String(opts.week));
  if (((id === "job" && todayView) || (id === "hold" && holdToday)) && opts.day) {
    q.set("day", String(opts.day));
  }
  return `/calls?${q.toString()}`;
}

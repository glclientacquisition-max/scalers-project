/** Inbox list pane on md+. Stored in CSS px. */

export const INBOX_SPLIT_KEY = "scalers-inbox-split";

/** 18rem. Rows, filters, and the Action dock still fit. */
export const INBOX_LIST_MIN = 288;

/** 40rem. Thread keeps the rest. */
export const INBOX_LIST_MAX = 640;

/** 20rem. Confirm stack and Summary stay readable. */
export const INBOX_THREAD_MIN = 320;

/** 1px gutter. The drag hit is a 24px overlay, not extra flex width. */
export const INBOX_SPLIT_GUTTER = 1;

export function clampInboxListWidth(px: number, parentWidth: number): number {
  const room = parentWidth - INBOX_THREAD_MIN - INBOX_SPLIT_GUTTER;
  const max = Math.min(INBOX_LIST_MAX, Math.max(INBOX_LIST_MIN, room));
  return Math.round(Math.min(max, Math.max(INBOX_LIST_MIN, px)));
}

/** Matches `md:w-[20rem] lg:w-[24rem] xl:w-[28rem]` once the rail is subtracted. */
export function inboxListDefaultWidth(parentWidth: number): number {
  if (parentWidth >= 1280 - 72) return 448;
  if (parentWidth >= 1024 - 72) return 384;
  return 320;
}

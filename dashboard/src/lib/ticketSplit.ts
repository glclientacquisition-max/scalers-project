/** Ticket summary pane on lg+. Stored in CSS px. Matches the shipped 18rem / 22rem grid. */

export const TICKET_SPLIT_KEY = "scalers-ticket-split";

/** 18rem. Want, Mood, Done, and editors still fit. */
export const TICKET_SUMMARY_MIN = 288;

/** 22rem. Default summary column. */
export const TICKET_SUMMARY_DEFAULT = 352;

/** 32rem. Transcript keeps the rest. */
export const TICKET_SUMMARY_MAX = 512;

/** 20rem. Thread stays readable. */
export const TICKET_THREAD_MIN = 320;

/** 1px gutter. The drag hit is a 24px overlay, not extra flex width. */
export const TICKET_SPLIT_GUTTER = 1;

export function clampTicketSummaryWidth(px: number, parentWidth: number): number {
  const room = parentWidth - TICKET_THREAD_MIN - TICKET_SPLIT_GUTTER;
  const max = Math.min(TICKET_SUMMARY_MAX, Math.max(TICKET_SUMMARY_MIN, room));
  return Math.round(Math.min(max, Math.max(TICKET_SUMMARY_MIN, px)));
}

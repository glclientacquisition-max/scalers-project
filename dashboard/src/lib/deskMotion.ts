/**
 * Desk motion verbs. Canon: docs/frontend/design-system/MASTER.md (Motion).
 * Skill: .cursor/skills/desk-motion/SKILL.md
 *
 * Surface types map onto these verbs. Do not add a sixth verb or a motion library.
 * 1 shell: none. 2 lists: land + shift. 3 detail: instant. 4 notice: DeskNotice.
 * 5 modal: enter-static. 6 state: shift. 7 empty/loading: pending spinner / static.
 * 8 numbers: instant tabular. 9 forms: shift. 10 routes: instant.
 */

export const DESK_LAND_MS = 900;
/** Live insert is one or two rows. A filter or page swap dumps more; do not flash those. */
export const DESK_LAND_MAX_FRESH = 3;
/** Notice enter and exit. Lockstep with `--motion-fast`. */
export const DESK_NOTICE_MS = 150;

export const deskLivePingClass = "desk-live-ping";
export const deskJustLandedClass = "desk-just-landed";
export const deskNoticeClass = "desk-notice";
export const deskNoticeOpenClass = "is-open";
export const deskNoticeLeaveClass = "is-leaving";

/** Named-property 150ms shift. Not layout, not `transition-all`. */
export const deskShiftClass =
  "desk-shift transition-[color,background-color,border-color,box-shadow,opacity,transform,filter] duration-[var(--motion-fast)] ease-out motion-reduce:transition-none";

export function nextLandedIds(
  seen: Set<string> | null,
  incoming: readonly string[],
  reset = false
): { seen: Set<string>; landed: string[] } {
  if (seen === null || reset) {
    return { seen: new Set(incoming), landed: [] };
  }
  const landed: string[] = [];
  for (const id of incoming) {
    if (!seen.has(id)) landed.push(id);
  }
  const next = new Set(seen);
  for (const id of incoming) next.add(id);
  if (landed.length > DESK_LAND_MAX_FRESH) {
    return { seen: next, landed: [] };
  }
  return { seen: next, landed };
}

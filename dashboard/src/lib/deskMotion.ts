/**
 * Desk motion verbs. Canon: docs/frontend/design-system/MASTER.md (Motion).
 * Skill: .cursor/skills/desk-motion/SKILL.md
 */

export const DESK_LAND_MS = 900;
/** Live insert is one or two rows. A filter or page swap dumps more; do not flash those. */
export const DESK_LAND_MAX_FRESH = 3;

export const deskLivePingClass = "desk-live-ping";
export const deskJustLandedClass = "desk-just-landed";

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

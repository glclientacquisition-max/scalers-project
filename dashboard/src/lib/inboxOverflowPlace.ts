export type InboxOverflowAnchor = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  align: "point" | "end";
};

const VIEWPORT_PAD = 8;
const GAP = 4;

/** Right-align to More so the list sits over Work, not Call / WhatsApp. Flip or clamp in the viewport. */
export function placeInboxOverflowMenu(
  panel: { width: number; height: number },
  anchor: InboxOverflowAnchor,
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const pad = VIEWPORT_PAD;
  let left: number;
  let top: number;

  if (anchor.align === "end") {
    const triggerRight = anchor.x + (anchor.w ?? 0);
    const triggerBottom = anchor.y + (anchor.h ?? 0);
    left = triggerRight - panel.width;
    top = triggerBottom + GAP;
    const above = anchor.y - panel.height - GAP;
    if (top + panel.height > viewport.height - pad && above >= pad) {
      top = above;
    }
  } else {
    left = anchor.x;
    top = anchor.y;
    if (left + panel.width > viewport.width - pad) {
      left = anchor.x - panel.width;
    }
    if (top + panel.height > viewport.height - pad) {
      top = anchor.y - panel.height;
    }
  }

  const maxLeft = Math.max(pad, viewport.width - panel.width - pad);
  const maxTop = Math.max(pad, viewport.height - panel.height - pad);
  left = Math.min(Math.max(left, pad), maxLeft);
  top = Math.min(Math.max(top, pad), maxTop);
  return { left, top };
}

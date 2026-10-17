import { LINE_PAUSED_BANNER } from "@/lib/tenantLineState";

/** Calm note on every Desk page while a Super Admin has paused the line. Reading still works. */
export function LinePausedBanner() {
  return (
    <div
      role="note"
      data-line-paused-banner=""
      className="border-b border-hairline bg-surface-2 px-4 py-2 text-center text-meta text-ink-2"
    >
      {LINE_PAUSED_BANNER}
    </div>
  );
}

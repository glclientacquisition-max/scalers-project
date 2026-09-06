import type { ReactNode } from "react";

/** Shared operational table chrome. Calls is the visual benchmark. */
export function DeskDataTable({
  minWidthClass = "min-w-[720px]",
  children,
}: {
  minWidthClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className={`w-full text-left text-sm ${minWidthClass}`}>
        {children}
      </table>
    </div>
  );
}

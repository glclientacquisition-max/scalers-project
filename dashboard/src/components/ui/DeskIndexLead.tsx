import type { ReactNode } from "react";

/** Tight lead row under the list-root title (search, Add, balance). */
export function DeskIndexLead({
  status,
  children,
}: {
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={[
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center",
        status ? "sm:justify-between" : "",
      ].join(" ")}
    >
      {status ? <div className="min-w-0 shrink-0">{status}</div> : null}
      {children ? (
        <div
          className={[
            "flex w-full min-w-0",
            status ? "sm:max-w-md sm:flex-1 sm:justify-end" : "",
          ].join(" ")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

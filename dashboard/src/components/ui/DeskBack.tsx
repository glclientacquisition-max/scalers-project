import type { ReactNode } from "react";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import { IconButtonLink } from "@/components/ui/IconButton";

/**
 * Previous screen. Icon-only chevron. 44px circle, brand ring, visible name on hover and focus.
 * The destination name is the accessible label.
 */
export function DeskBack({
  href,
  children,
  className,
}: {
  href: string;
  children: string;
  className?: string;
}) {
  return (
    <IconButtonLink href={href} label={children} className={className} data-desk-back="">
      <ChevronLeftIcon aria-hidden="true" />
    </IconButtonLink>
  );
}

/**
 * Nested record lead. Back never owns a row. Chevron sits in the first content row
 * with the title or identity. Trail hits (Call, WhatsApp, More, Save) stay on the right.
 */
export function DeskRecordLead({
  back,
  trail,
  children,
  align = "start",
}: {
  back?: ReactNode;
  trail?: ReactNode;
  children: ReactNode;
  align?: "start" | "center";
}) {
  return (
    <div
      data-desk-record-lead=""
      className={[
        "flex min-w-0 gap-1",
        align === "center" ? "items-center" : "items-start",
      ].join(" ")}
    >
      {back}
      <div className="min-w-0 flex-1">{children}</div>
      {trail ? <div className="shrink-0">{trail}</div> : null}
    </div>
  );
}

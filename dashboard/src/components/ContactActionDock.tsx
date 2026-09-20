import type { ReactNode } from "react";
import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";

function DockSlot({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      {children}
      <span className="text-[11px] font-medium leading-none text-ink-soft">{label}</span>
    </div>
  );
}

export function ContactActionDock({ number }: { number: string }) {
  if (!String(number || "").trim()) return null;

  return (
    <nav
      data-contact-action-dock=""
      aria-label="Contact actions"
      className="pt-1"
    >
      <div className="flex items-start gap-3">
        <DockSlot label="Call">
          <CallLink number={number} />
        </DockSlot>
        <DockSlot label="WhatsApp">
          <WhatsAppLink number={number} variant="icon" />
        </DockSlot>
      </div>
    </nav>
  );
}

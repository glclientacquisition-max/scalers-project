import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";

export function ContactActionDock({ number }: { number: string }) {
  if (!String(number || "").trim()) return null;

  return (
    <nav
      data-contact-action-dock=""
      aria-label="Contact actions"
      className="flex shrink-0 items-center justify-end gap-2"
    >
      <CallLink number={number} />
      <WhatsAppLink number={number} variant="icon" />
    </nav>
  );
}

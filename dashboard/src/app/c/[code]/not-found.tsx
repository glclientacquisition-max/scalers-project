import { DeskRecovery } from "@/components/ui/DeskRecovery";

/** Unknown code and a call outside the person's businesses look the same. */
export default function ShortCallLinkNotFound() {
  return <DeskRecovery screen title="Link not found" line="Check the link in the text, or find the call in the Inbox." href="/calls" action="Inbox" />;
}

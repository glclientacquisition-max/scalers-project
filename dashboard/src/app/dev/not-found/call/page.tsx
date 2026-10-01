import { notFound } from "next/navigation";
import { DeskRecovery } from "@/components/ui/DeskRecovery";
import { DevNotFoundFrame } from "../frame";

/** Missing-call slot, same shell as the desk 404 harness. */
export default function DevMissingCallPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <DevNotFoundFrame>
      <DeskRecovery title="This call is not in the inbox." href="/calls" action="Inbox" />
    </DevNotFoundFrame>
  );
}

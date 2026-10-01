import { notFound } from "next/navigation";
import { DeskRecovery } from "@/components/ui/DeskRecovery";
import { DevNotFoundFrame } from "./frame";

/**
 * Local 404 harness (no desk login). DASHBOARD_OPEN=true only.
 * Same DeskRecovery block as `(desk)/not-found.tsx`, inside a static shell.
 */
export default function DevNotFoundPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <DevNotFoundFrame>
      <DeskRecovery
        title="Page not found"
        line="That address is not a Scalers page."
        href="/home"
        action="Overview"
      />
    </DevNotFoundFrame>
  );
}

import { DeskRecovery } from "@/components/ui/DeskRecovery";

/** Unmatched desk `notFound()` stays in the shell. Rail and tabs come from the layout. */
export default function DeskNotFound() {
  return (
    <DeskRecovery
      title="Page not found"
      line="That address is not a Scalers page."
      href="/home"
      action="Overview"
    />
  );
}

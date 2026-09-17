import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";

export default function DeskLoading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className={pendingSpinnerInkClass} />
      <span className="sr-only">Loading</span>
    </div>
  );
}

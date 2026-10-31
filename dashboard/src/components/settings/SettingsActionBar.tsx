"use client";

import { Button } from "@/components/ui/Button";

/**
 * Settings save bar, from the Service areas footer.
 * Phone: sticks to the bottom, above the safe area.
 * md+: sits at the end of the form.
 * Clean: "No changes" and a disabled Save. Dirty: "Save" or "Save N changes".
 */
export function SettingsActionBar({
  changes,
  pending = false,
  saved = false,
  note,
  noteTone = "quiet",
  form,
  onSave,
  onUndo,
}: {
  changes: number;
  pending?: boolean;
  saved?: boolean;
  /** Replaces the change count. A failed save, or "Saved". */
  note?: string | null;
  noteTone?: "quiet" | "attention";
  form?: string;
  onSave?: () => void;
  onUndo?: () => void;
}) {
  const clean = changes <= 0;
  const label = pending ? "Saving" : saved && clean ? "Saved" : changes > 1 ? `Save ${changes} changes` : "Save";
  return (
    <div
      data-settings-action-bar=""
      className="sticky bottom-0 z-sticky mt-auto flex items-center gap-2.5 border-t border-hairline bg-surface px-4 pt-3 md:static"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <span role="status" className={note && noteTone === "attention" ? "flex-1 text-meta text-attention" : "flex-1 text-meta text-ink-2"}>
        {note ? note : clean ? (saved ? "Saved" : "No changes") : `${changes} ${changes === 1 ? "change" : "changes"}`}
      </span>
      {onUndo && !clean ? (
        <Button type="button" variant="ghost" size="lg" onClick={onUndo} disabled={pending}>
          Undo
        </Button>
      ) : null}
      <Button
        type={onSave ? "button" : "submit"}
        form={onSave ? undefined : form}
        variant="primary"
        size="lg"
        pending={pending}
        disabled={clean || pending}
        data-settings-save=""
        onClick={onSave}
      >
        {label}
      </Button>
    </div>
  );
}

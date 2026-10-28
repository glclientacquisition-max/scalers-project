"use client";

import { Switch } from "@/components/ui/Switch";
import { SaveStatus, type CardSaveState } from "@/components/policies/policiesKit";
import { cx } from "@/lib/cx";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { TAKE_MESSAGES_COPY, ownerCanChange, takeMessagesLine, type TakeMessagesState } from "@/lib/takeMessages";

/**
 * Identity > How you answer: "Take messages only". Off by default, saves on its own (not with the
 * card's Save). On: the row turns tonal and says so in words. A hold from Scalers support or the env
 * shows as on and locked, with who did it and how to get help.
 */
export function TakeMessagesRow({
  state,
  status,
  canEdit,
  onChange,
}: {
  state: TakeMessagesState;
  status: CardSaveState;
  canEdit: boolean;
  onChange: (on: boolean) => void;
}) {
  const locked = !ownerCanChange(state);
  return (
    <div
      id="take-messages"
      className={cx("scroll-mt-24 px-4 py-3", deskShiftClass, state.on ? "bg-accent-soft" : "")}
      data-take-messages={state.on ? state.by || "owner" : "off"}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 pt-2.5">
          <label htmlFor="take-messages-switch" className="block text-body font-medium text-ink">
            {TAKE_MESSAGES_COPY.label}
          </label>
          <p id="take-messages-help" className="mt-0.5 text-meta text-ink-2" data-take-messages-line="">
            {takeMessagesLine(state)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SaveStatus status={status} label={TAKE_MESSAGES_COPY.label} />
          <Switch
            id="take-messages-switch"
            label={TAKE_MESSAGES_COPY.label}
            describedBy="take-messages-help"
            checked={state.on}
            disabled={!canEdit || locked}
            onCheckedChange={(next) => {
              if (canEdit && !locked) onChange(next);
            }}
          />
        </div>
      </div>
      {status.state === "error" ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3" data-save-error="">
          <p className="min-w-0 flex-1 text-body text-warn" role="alert">
            {status.error}
          </p>
          {status.retry ? (
            <button
              type="button"
              onClick={status.retry}
              className="min-h-11 shrink-0 rounded-xl px-2 text-body font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

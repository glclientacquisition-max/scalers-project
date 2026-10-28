"use client";

import { CheckIcon } from "@heroicons/react/20/solid";
import { SaveStatus, type CardSaveState } from "@/components/policies/policiesKit";
import { cx } from "@/lib/cx";
import { deskShiftClass } from "@/lib/deskMotion";
import { CATALOGUE_COMPLETE_COPY, catalogueCompleteLine, markedOnLine } from "@/lib/takeMessages";

/**
 * Catalogue > What you sell: "My list is complete". One native checkbox that saves on its own.
 * Ticked: callers asking for something not listed hear that the business doesn't offer it.
 * Not ticked: they hear the team will confirm. Shows the day it was marked.
 */
export function CatalogueCompleteRow({
  completeAt,
  status,
  canEdit,
  onChange,
}: {
  completeAt: string | null;
  status: CardSaveState;
  canEdit: boolean;
  onChange: (complete: boolean) => void;
}) {
  const complete = Boolean(completeAt);
  const marked = complete ? markedOnLine(completeAt) : null;
  return (
    <div className="border-t border-hairline px-4 py-2" data-catalogue-complete={complete ? "on" : "off"}>
      <div className="flex items-start gap-2">
        <label
          className={cx(
            "flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg py-1.5",
            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
            canEdit ? "cursor-pointer" : "cursor-default",
          )}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={complete}
            disabled={!canEdit}
            aria-describedby="catalogue-complete-help"
            onChange={(e) => {
              if (canEdit) onChange(e.target.checked);
            }}
            data-catalogue-complete-box=""
          />
          <span
            aria-hidden
            className={cx(
              "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border-2",
              deskShiftClass,
              complete ? "border-accent bg-accent text-accent-on" : "border-ink-2 bg-surface",
              !canEdit && "opacity-60",
            )}
          >
            {complete ? <CheckIcon className="size-4" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-ink">{CATALOGUE_COMPLETE_COPY.label}</span>
            <span id="catalogue-complete-help" className="block text-meta text-ink-2">
              {catalogueCompleteLine(complete)}
              {marked ? <span data-catalogue-complete-at="">{` ${marked}.`}</span> : null}
            </span>
          </span>
        </label>
        <SaveStatus status={status} label={CATALOGUE_COMPLETE_COPY.label} />
      </div>
      {status.state === "error" ? (
        <div className="flex flex-wrap items-center gap-x-3 pb-1" data-save-error="">
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

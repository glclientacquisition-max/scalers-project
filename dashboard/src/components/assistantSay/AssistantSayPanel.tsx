"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import {
  BanknotesIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CreditCardIcon,
  MapPinIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import { KbPendingNote } from "@/components/KbPendingNote";
import { ButtonLink } from "@/components/ui/Button";
import { settingsFormBodyClass } from "@/components/settingsUi";
import type { LookupPreviewSamples } from "@/lib/assistantSayVoice.server";
import type { AssistantSayRow, AssistantSayState } from "@/lib/assistantSayTypes";
import {
  ASSISTANT_SAY_PAGE_TITLE,
  sortAssistantSayRows,
  topicFixHref,
  topicLookupKind,
} from "@/lib/assistantSayTopics";
import type { BusinessType } from "@/lib/businessType";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { cx } from "@/lib/cx";
import type { TenantRow } from "@/lib/supabase";
import { AssistantSayTopicSheet } from "@/components/assistantSay/AssistantSayTopicSheet";
import type { UnknownAnswerByKind } from "@/lib/unknownAnswerByKindConstants";

const TOPIC_ICONS: Record<string, typeof ChatBubbleLeftRightIcon> = {
  greeting: ChatBubbleLeftRightIcon,
  prices: BanknotesIcon,
  hours: ClockIcon,
  areas: MapPinIcon,
  payment: CreditCardIcon,
  unsure: QuestionMarkCircleIcon,
};

function stampDotClass(tone: AssistantSayRow["stampTone"]): string {
  if (tone === "ok" || tone === "live") return "bg-ok";
  if (tone === "attention") return "bg-attention";
  return "bg-ink-3";
}

function listPreview(row: AssistantSayRow): string {
  const hear = String(row.hearPreview || "").trim();
  if (hear) return hear;
  return row.reason;
}

export function AssistantSayPanel({
  state,
  pending = false,
  samples,
  tenant,
  businessType,
  initialTopic = null,
  initialByKind,
  legacyGeneral,
}: {
  state: AssistantSayState;
  pending?: boolean;
  samples: LookupPreviewSamples;
  tenant: TenantRow;
  businessType: BusinessType;
  initialTopic?: string | null;
  initialByKind: UnknownAnswerByKind | null;
  legacyGeneral?: string | null;
}) {
  const router = useRouter();
  const rows = useMemo(() => sortAssistantSayRows(state.rows), [state.rows]);
  const [openTopic, setOpenTopic] = useState<string | null>(initialTopic);
  const activeRow = rows.find((r) => r.id === openTopic) ?? null;

  useEffect(() => {
    if (initialTopic) setOpenTopic(initialTopic);
  }, [initialTopic]);

  const progress = state.total > 0 ? Math.round((state.readyCount / state.total) * 100) : 0;

  return (
    <div className={settingsFormBodyClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body tabular-nums text-ink">
          <span className="font-medium text-ink">{state.readyCount}</span>
          <span className="text-ink-2"> of {state.total} ready</span>
        </p>
        <ButtonLink href={businessSettingsHref("test")} variant="tonal" size="md">
          Test a call
        </ButtonLink>
      </div>
      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={state.readyCount}
        aria-valuemin={0}
        aria-valuemax={state.total}
        aria-label={`${state.readyCount} of ${state.total} topics ready`}
      >
        <div
          className="h-full rounded-full bg-accent motion-reduce:transition-none transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <KbPendingNote pending={pending} className="mt-4" />

      <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={cx(
                "flex min-h-14 w-full items-start gap-3 px-1 py-3 text-start",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
              onClick={() => setOpenTopic(row.id)}
              aria-label={`${row.title}, ${row.stampLabel}`}
            >
              {(() => {
                const Icon = TOPIC_ICONS[row.id] ?? QuestionMarkCircleIcon;
                return (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                );
              })()}
              <span className="min-w-0 flex-1">
                <span className="text-body font-medium text-ink">{row.title}</span>
                <span className="mt-0.5 block line-clamp-2 text-meta text-ink-2 [overflow-wrap:anywhere]">
                  {listPreview(row) ? `"${listPreview(row)}"` : row.reason}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cx("size-2 shrink-0 rounded-full", stampDotClass(row.stampTone))}
                    aria-hidden="true"
                  />
                  <span className="text-meta text-ink-2">{row.stampLabel}</span>
                </span>
                <ChevronRightIcon className="size-5 text-ink-3" aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {activeRow ? (
        <AssistantSayTopicSheet
          key={activeRow.id}
          row={activeRow}
          open={Boolean(openTopic)}
          onOpenChange={(next) => {
            if (!next) {
              setOpenTopic(null);
              router.replace("/settings?tab=assistant-say", { scroll: false });
            }
          }}
          samples={samples}
          tenant={tenant}
          businessType={businessType}
          initialByKind={initialByKind}
          legacyGeneral={legacyGeneral}
          lookupKind={topicLookupKind(activeRow.id)}
          fixHref={topicFixHref(activeRow)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

export { ASSISTANT_SAY_PAGE_TITLE };

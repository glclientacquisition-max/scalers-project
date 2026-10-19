"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckIcon } from "@heroicons/react/20/solid";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { SettingsGroup } from "@/components/settingsUi";
import { Button } from "@/components/ui/Button";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import type { ReadyChecklistItem } from "@/lib/assistantSayTypes";
import type { OverviewDataCheck } from "@/components/structured/OverviewDataChecksCard";
import { confirmCheckForReadyItem } from "@/lib/overviewDataChecks";
import {
  OverviewCheckSheetHost,
  openSheetFromCheck,
  type OpenOverviewCheck,
} from "@/components/structured/overviewCheckSheets";

/** Compact checklist on Overview until every item is done. */
export function HomeGetReadyCallsCard({
  items,
  checks = [],
  canEdit = true,
}: {
  items: ReadyChecklistItem[];
  checks?: OverviewDataCheck[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenOverviewCheck>(null);

  const readyCount = useMemo(() => items.filter((i) => i.complete).length, [items]);
  const total = items.length;

  if (!items.length || items.every((i) => i.complete)) return null;

  function finish() {
    setOpen(null);
    router.refresh();
  }

  function openConfirm(item: ReadyChecklistItem) {
    const check = confirmCheckForReadyItem(item, checks);
    if (!check || !canEdit) return;
    setOpen(openSheetFromCheck(check));
  }

  return (
    <>
      <SettingsGroup
        title="Get ready for calls"
        action={
          <span className="text-meta tabular-nums text-ink-3">
            {readyCount} of {total} ready
          </span>
        }
      >
        <ul className="divide-y divide-hairline">
          {items.map((item) => {
            const confirmCheck = confirmCheckForReadyItem(item, checks);
            return (
              <li
                key={item.id}
                className="flex min-h-12 flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                  <span
                    className={[
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      item.complete ? "bg-ok-tonal text-ok" : "border border-hairline",
                    ].join(" ")}
                    aria-hidden={item.complete ? undefined : true}
                  >
                    {item.complete ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    {item.complete ? (
                      <span className="text-body text-ink-2">
                        <span className="sr-only">Ready: </span>
                        {item.label}
                      </span>
                    ) : (
                      <>
                        <Link
                          href={item.href}
                          className={[
                            "text-body font-medium text-accent-deep underline-offset-2 hover:underline",
                            deskShiftClass,
                            focusRingVisible,
                          ].join(" ")}
                        >
                          {item.label}
                        </Link>
                        {item.reason ? (
                          <p className="mt-0.5 line-clamp-2 text-meta text-ink-3">{item.reason}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                {confirmCheck && canEdit ? (
                  <Button
                    type="button"
                    variant="tonal"
                    size="sm"
                    className="shrink-0 self-start sm:self-center"
                    onClick={() => openConfirm(item)}
                  >
                    Confirm
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-hairline px-4 py-3 text-meta text-ink-3">
          <Link
            href={businessSettingsHref("assistant-say")}
            className={[
              "font-medium text-accent-deep underline-offset-2 hover:underline",
              deskShiftClass,
              focusRingVisible,
            ].join(" ")}
          >
            What your Business Assistant will say
          </Link>
        </p>
      </SettingsGroup>

      <OverviewCheckSheetHost open={open} onClose={() => setOpen(null)} onSaved={() => finish()} />
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { SettingsGroup } from "@/components/settingsUi";
import { deskShiftClass } from "@/components/ui/deskChrome";
import type { PriceToConfirm } from "@/components/structured/PriceConfirmCards";
import type { Payments } from "@/lib/payments";
import type { HoursSchedule } from "@/lib/hoursSchedule";
import type { ServiceAreas } from "@/lib/serviceAreas";
import { checkKey } from "@/lib/overviewDataChecks";
import {
  OverviewCheckSheetHost,
  openSheetFromCheck,
  type OpenOverviewCheck,
} from "@/components/structured/overviewCheckSheets";

export type OverviewDataCheck =
  | { kind: "link"; href: string; label: string; detail: string }
  | {
      kind: "prices";
      href: string;
      label: string;
      detail: string;
      items: PriceToConfirm[];
    }
  | {
      kind: "payments";
      href: string;
      label: string;
      detail: string;
      payments: Payments;
      legacyText: string;
    }
  | {
      kind: "hours";
      href: string;
      label: string;
      detail: string;
      schedule: HoursSchedule;
    }
  | {
      kind: "areas";
      href: string;
      label: string;
      detail: string;
      areas: ServiceAreas;
      vertical: string | null;
    };

/** Overview: owner "Is this right?" checks open a sheet and save on the same paths as Settings. */
export function OverviewDataChecksCard({
  checks,
  canEdit = true,
}: {
  checks: OverviewDataCheck[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenOverviewCheck>(null);
  const [doneKeys, setDoneKeys] = useState<string[]>([]);

  const visible = useMemo(
    () => checks.filter((c) => !doneKeys.includes(checkKey(c))),
    [checks, doneKeys]
  );

  if (!visible.length) return null;

  function openCheck(c: OverviewDataCheck) {
    if (c.kind === "link") return;
    if (!canEdit) return;
    setOpen(openSheetFromCheck(c));
  }

  function finish(key: string) {
    setDoneKeys((d) => [...d, key]);
    setOpen(null);
    router.refresh();
  }

  return (
    <>
      <SettingsGroup title="Is this right?">
        {visible.map((c) => {
          const key = checkKey(c);
          const rowClass = `flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${deskShiftClass}`;
          if (c.kind === "link") {
            return (
              <Link key={key} href={c.href} className={rowClass}>
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">{c.label}</span>
                  <span className="block text-meta text-ink-2">{c.detail}</span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
              </Link>
            );
          }
          return (
            <button key={key} type="button" className={rowClass} onClick={() => openCheck(c)} disabled={!canEdit}>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">{c.label}</span>
                <span className="block text-meta text-ink-2">{c.detail}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
            </button>
          );
        })}
      </SettingsGroup>

      <OverviewCheckSheetHost open={open} onClose={() => setOpen(null)} onSaved={finish} />
    </>
  );
}

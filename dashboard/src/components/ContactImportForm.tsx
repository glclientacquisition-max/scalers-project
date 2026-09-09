"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applyContactCsv,
  previewContactCsv,
  type ContactImportApplyState,
  type ContactImportPreviewState,
} from "@/app/(desk)/contacts/actions";
import {
  settingsActionClass,
  settingsFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

const previewInitial: ContactImportPreviewState = {};
const applyInitial: ContactImportApplyState = {};

export function ContactImportForm() {
  const router = useRouter();
  const [csvText, setCsvText] = useState("");
  const [previewState, previewAction, previewPending] = useActionState(
    previewContactCsv,
    previewInitial
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyContactCsv,
    applyInitial
  );

  useEffect(() => {
    if (previewState.ok && previewState.csv) setCsvText(previewState.csv);
  }, [previewState]);

  useEffect(() => {
    if (applyState.ok) {
      router.push("/contacts");
      router.refresh();
    }
  }, [applyState.ok, router]);

  const plan = previewState.plan;
  const summary = plan?.summary;

  return (
    <div className="space-y-6">
      {!plan ? (
        <form action={previewAction} className="space-y-4">
          <label className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            CSV
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              required
              className={`${settingsFieldClass} file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium`}
            />
          </label>
          <button type="submit" disabled={previewPending} className={settingsPrimaryButtonClass}>
            {previewPending ? "Checking" : "Preview"}
          </button>
          {previewState.error ? (
            <p className="text-sm text-warn">{previewState.error}</p>
          ) : null}
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            {summary?.create || 0} will be created. {summary?.skipped || 0} skipped as
            duplicates. {summary?.rejected || 0} rejected as invalid.
          </p>

          {plan.rejected.length ? (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em]">
                      Row
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em]">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em]">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rejected.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-line/70">
                      <td className="px-4 py-3">{row.rowNumber}</td>
                      <td className="px-4 py-3 font-mono">{row.phone || "None"}</td>
                      <td className="px-4 py-3 text-warn">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {plan.skipped.length ? (
            <ul className="space-y-1 text-sm text-ink-soft">
              {plan.skipped.map((row) => (
                <li key={`${row.rowNumber}-${row.phone}`}>
                  Row {row.rowNumber}: {row.phone} {row.reason}
                  {row.existingId ? (
                    <>
                      {" "}
                      <Link
                        href={`/contacts/${row.existingId}`}
                        className="font-medium text-[#005CCC] hover:underline"
                      >
                        Open
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <form action={applyAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="csvText" value={csvText} />
            <input type="hidden" name="confirm" value="1" />
            <button
              type="submit"
              disabled={applyPending || !plan.create.length}
              className={settingsPrimaryButtonClass}
            >
              {applyPending ? "Importing" : "Import"}
            </button>
            <button
              type="button"
              className={settingsActionClass}
              onClick={() => window.location.reload()}
            >
              Cancel
            </button>
          </form>
          {applyState.error ? (
            <p className="text-sm text-warn">{applyState.error}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { DroppingMark, FailChips, QualitySpark, formatCallWhen } from "@/components/admin/QualityBits";
import { ListRow } from "@/components/ui/ListRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { Table, Tbody, Td, Th, Thead } from "@/components/ui/Table";
import {
  checkLabel,
  failingChecks,
  formatDuration,
  formatScore,
  qualityBusinessHref,
  qualityCallHref,
  sortWorstFirst,
  type BusinessQualityDetail,
  type QualityRange,
} from "@/lib/adminQualityModel";

export function QualityBusiness({
  detail,
  range,
  base = "/admin/quality",
}: {
  detail: BusinessQualityDetail;
  range: QualityRange;
  base?: string;
}) {
  const calls = sortWorstFirst(detail.calls);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <PageHeader title={detail.name} />
        <div className="flex flex-wrap items-center gap-3 px-0">
          <p className="text-title tabular-nums text-ink">{formatScore(detail.score)}</p>
          <QualitySpark points={detail.trend} dropping={detail.dropping} />
          <DroppingMark dropping={detail.dropping} reason={detail.droppingReason} />
        </div>
        <Segmented
          label="Range"
          items={[
            {
              key: "7d",
              label: "7 days",
              href: qualityBusinessHref(base, detail.businessId, "7d"),
              active: range === "7d",
            },
            {
              key: "30d",
              label: "30 days",
              href: qualityBusinessHref(base, detail.businessId, "30d"),
              active: range === "30d",
            },
          ]}
        />
      </header>

      <section>
        <h2 className="px-4 text-title text-ink">Calls</h2>
        {calls.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-2">No traced calls yet.</p>
        ) : (
          <>
            <div className="mt-2 hidden min-w-0 md:block">
              <Table>
                <caption className="sr-only">Calls, worst first</caption>
                <Thead>
                  <tr>
                    <Th>Call</Th>
                    <Th num>Score</Th>
                    <Th>Failing checks</Th>
                    <Th num>Duration</Th>
                    <Th>Time</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {calls.map((call) => (
                    <tr key={call.callId} className="relative hover:bg-surface-2/60 focus-within:bg-surface-2/60">
                      <Td>
                        <Link
                          href={qualityCallHref(base, call.callId)}
                          className="rounded-md font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          {call.callId}
                        </Link>
                      </Td>
                      <Td num>{formatScore(call.score)}</Td>
                      <Td>
                        <FailChips checks={call.checks} />
                      </Td>
                      <Td num>{formatDuration(call.durationSec)}</Td>
                      <Td className="tabular-nums text-ink-2">{formatCallWhen(call.at)}</Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            </div>
            <ul className="mt-2 divide-y divide-hairline md:hidden">
              {calls.map((call) => {
                const failed = failingChecks(call.checks);
                const failure = failed.length > 0 ? failed.map((check) => checkLabel(check)).join(", ") : "No failing checks";
                return (
                  <ListRow
                    key={call.callId}
                    href={qualityCallHref(base, call.callId)}
                    title={call.callId}
                    preview={`${formatDuration(call.durationSec)}. ${failure}`}
                    when={formatScore(call.score)}
                  />
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2 className="px-4 text-title text-ink">Repeat failures</h2>
        {detail.repeatFailures.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-2">No repeat failures.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline">
            {detail.repeatFailures.map((row) => (
              <ListRow key={row.check} title={`${checkLabel(row.check)} × ${row.calls}`} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="px-4 text-title text-ink">Couldn&apos;t answer</h2>
        {detail.couldntAnswer.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-2">No missed questions.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline">
            {detail.couldntAnswer.map((question) => (
              <li key={question} className="px-4 py-3 text-body text-ink [overflow-wrap:anywhere]">
                {question}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

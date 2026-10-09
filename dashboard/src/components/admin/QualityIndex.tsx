"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { QualityEmpty } from "@/components/admin/QualityEmpty";
import { DeltaMark, DroppingMark, QualitySpark, Unlogged, formatCallWhen } from "@/components/admin/QualityBits";
import { ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Stamp } from "@/components/ui/Stamp";
import { Table, Tbody, Td, Th, Thead } from "@/components/ui/Table";
import {
  callCountLabel,
  checkLabel,
  formatScore,
  qualityBusinessHref,
  qualityListHref,
  releaseName,
  sortWorstFirst,
  VOICE_CHECKS,
  type BusinessQualityRow,
  type QualityRange,
  type ReleaseDelta,
} from "@/lib/adminQualityModel";

function failureText(row: BusinessQualityRow): string {
  if (row.topFailure) return checkLabel(row.topFailure);
  return row.checksLogged ? "No failures" : "Checks not logged";
}

function phonePreview(row: BusinessQualityRow): string {
  const failure = failureText(row);
  const calls = callCountLabel(row.callsTraced);
  if (row.dropping) return `${calls}. ${failure}. ${row.droppingReason}`;
  return `${calls}. ${failure}`;
}

function checkRows(delta: ReleaseDelta) {
  return VOICE_CHECKS.flatMap((check) => {
    const before = delta.before.checks[check] || 0;
    const after = delta.after.checks[check] || 0;
    if (before === 0 && after === 0) return [];
    return [{ check, before, after, delta: after - before }];
  });
}

function ScoreText({ score }: { score: number | null }) {
  if (score == null) return <Unlogged />;
  return formatScore(score);
}

export function QualityIndex({
  range,
  rows,
  releases,
  base = "/admin/quality",
}: {
  range: QualityRange;
  rows: BusinessQualityRow[];
  releases: ReleaseDelta[];
  base?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((row) => row.name.toLowerCase().includes(q)) : rows;
    return sortWorstFirst(filtered);
  }, [query, rows]);

  return (
    <div className="space-y-8">
      <section>
        <header className="px-4 pb-3">
          <h1 className="text-page text-ink">Quality</h1>
          <p className="mt-0.5 text-meta text-ink-2">Traced calls, worst first.</p>
        </header>
        <div className="px-4 pb-2">
          <Input
            id="quality-search"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search"
            aria-label="Search businesses"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Segmented
          label="Range"
          items={[
            { key: "7d", label: "7 days", href: qualityListHref(base, "7d"), active: range === "7d" },
            { key: "30d", label: "30 days", href: qualityListHref(base, "30d"), active: range === "30d" },
          ]}
        />
        {rows.length === 0 ? (
          <QualityEmpty action={<ButtonLink href="/admin/businesses">Businesses</ButtonLink>} />
        ) : shown.length === 0 ? (
          <Empty title="No business matches." line="Try another name." />
        ) : (
          <>
            <div className="hidden min-w-0 md:block">
              <Table>
                <caption className="sr-only">Business quality, worst first</caption>
                <Thead>
                  <tr>
                    <Th>Business</Th>
                    <Th num>Score</Th>
                    <Th>Trend</Th>
                    <Th>Top failure</Th>
                    <Th>Dropping</Th>
                    <Th num>Calls traced</Th>
                    <Th>Last call</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {shown.map((row) => {
                    const href = qualityBusinessHref(base, row.businessId, range);
                    return (
                      <tr key={row.businessId} className="relative hover:bg-surface-2/60 focus-within:bg-surface-2/60">
                        <Td>
                          <Link
                            href={href}
                            className="inline-flex min-h-11 items-center rounded-md font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-brand"
                          >
                            {row.name}
                          </Link>
                        </Td>
                        <Td num>
                          <ScoreText score={row.score} />
                        </Td>
                        <Td>
                          <QualitySpark points={row.trend} dropping={row.dropping} />
                        </Td>
                        <Td>{row.topFailure ? checkLabel(row.topFailure) : <Unlogged>{failureText(row)}</Unlogged>}</Td>
                        <Td>
                          <DroppingMark dropping={row.dropping} reason={row.droppingReason} />
                        </Td>
                        <Td num>{row.callsTraced}</Td>
                        <Td className="tabular-nums text-ink-2">
                          {row.lastCallAt ? formatCallWhen(row.lastCallAt) : <Unlogged />}
                        </Td>
                      </tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
            <ul className="divide-y divide-hairline md:hidden">
              {shown.map((row) => (
                <ListRow
                  key={row.businessId}
                  href={qualityBusinessHref(base, row.businessId, range)}
                  leading={<QualitySpark points={row.trend} dropping={row.dropping} />}
                  title={row.name}
                  preview={phonePreview(row)}
                  when={row.score == null ? undefined : formatScore(row.score)}
                  stamp={
                    row.dropping ? (
                      <Stamp tone="attention">Dropping</Stamp>
                    ) : (
                      <span className="text-meta text-ink-3">Steady</span>
                    )
                  }
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2 className="px-4 text-title text-ink">Release before/after</h2>
        {releases.length === 0 ? (
          <Empty title="No releases to compare." line="Traced calls on both sides of a release show here." />
        ) : (
          <>
            <div className="mt-2 hidden min-w-0 md:block">
              <Table>
                <caption className="sr-only">Release score and checks, before and after</caption>
                <Thead>
                  <tr>
                    <Th>Release</Th>
                    <Th num>Score before</Th>
                    <Th num>Score after</Th>
                    <Th num>Delta</Th>
                    <Th>Checks</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {releases.map((row) => {
                    const delta =
                      row.before.avgScore == null || row.after.avgScore == null
                        ? null
                        : row.after.avgScore - row.before.avgScore;
                    return (
                      <tr key={row.release.gitSha}>
                        <Td>
                          <span className="block font-medium text-ink">{releaseName(row)}</span>
                          {row.release.label && row.at ? (
                            <span className="text-caption tabular-nums text-ink-3">{formatCallWhen(row.at)}</span>
                          ) : null}
                        </Td>
                        <Td num>
                          <ScoreText score={row.before.avgScore} />
                        </Td>
                        <Td num>
                          <ScoreText score={row.after.avgScore} />
                        </Td>
                        <Td num>
                          <DeltaMark delta={delta} />
                        </Td>
                        <Td>
                          <ul className="space-y-1">
                            {checkRows(row).map((line) => (
                              <li key={line.check} className="text-meta tabular-nums text-ink-2">
                                {checkLabel(line.check)} {line.before} to {line.after} (
                                <DeltaMark delta={line.delta} lowerIsBetter />)
                              </li>
                            ))}
                          </ul>
                        </Td>
                      </tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
            <ul className="mt-2 divide-y divide-hairline md:hidden">
              {releases.map((row) => {
                const delta =
                  row.before.avgScore == null || row.after.avgScore == null
                    ? null
                    : row.after.avgScore - row.before.avgScore;
                return (
                  <li key={row.release.gitSha} className="space-y-1 px-4 py-3">
                    <p className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{releaseName(row)}</span>
                      {row.release.label && row.at ? (
                        <span className="shrink-0 text-caption tabular-nums text-ink-3">{formatCallWhen(row.at)}</span>
                      ) : null}
                    </p>
                    <p className="text-meta tabular-nums text-ink-2">
                      Score <ScoreText score={row.before.avgScore} /> to <ScoreText score={row.after.avgScore} /> (
                      <DeltaMark delta={delta} />)
                    </p>
                    <ul className="space-y-0.5">
                      {checkRows(row).map((line) => (
                        <li key={line.check} className="text-meta tabular-nums text-ink-2">
                          {checkLabel(line.check)} {line.before} to {line.after} (
                          <DeltaMark delta={line.delta} lowerIsBetter />)
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

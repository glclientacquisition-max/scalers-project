"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { businessPaneHref } from "@/lib/ops/businessPane";
import {
  callCountLabel,
  checkLabel,
  diagnosisLine,
  failingChecks,
  finalStt,
  formatDelta,
  formatDuration,
  qualityBusinessHref,
  releaseName,
  formatScore,
  latencyMs,
  qualityCallHref,
  spokenLine,
  type BusinessQualityDetail,
  type BusinessQualityRow,
  type QualityRange,
  type ReleaseDelta,
  type VoiceCallTrace,
} from "@/lib/adminQualityModel";
import { EmptyState, PageHeader, Sparkline, SplitLayout, SplitPane, StatusPill, type OpsTone } from "@/components/ops";
import "@/styles/ops.css";

const WHEN = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
const when = (iso: string | null) => (iso ? WHEN.format(new Date(iso)) : "—");
export const scoreTone = (s: number | null): OpsTone => (s == null ? "neutral" : s < 50 ? "danger" : s < 70 ? "warn" : "ok");

/** Query string for Quality v2: range, business pane, call pane. */
export function qualityV2Href(base: string, o: { range: QualityRange; pane?: string | null; call?: string | null }): string {
  const q = new URLSearchParams();
  if (o.range === "30d") q.set("range", "30d");
  if (o.pane) q.set("pane", o.pane);
  if (o.call) q.set("call", o.call);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * Quality (ADMIN_V2): businesses worst first; the pane shows a business's calls, and a call opens its
 * detail in the same pane (transcript, checks, timing). Read-only. State lives in the URL.
 */
export function AdminQualityV2({
  base,
  range,
  rows,
  business,
  call,
  callBusiness = null,
  releases = [],
}: {
  base: string;
  range: QualityRange;
  rows: BusinessQualityRow[];
  business: BusinessQualityDetail | null;
  call: VoiceCallTrace | null;
  /** The call's business, for the "other calls" list in the call pane. */
  callBusiness?: BusinessQualityDetail | null;
  releases?: ReleaseDelta[];
}) {
  const router = useRouter();
  const sel = call?.businessId ?? business?.businessId ?? null;
  const href = (o: { pane?: string | null; call?: string | null; range?: QualityRange }) => qualityV2Href(base, { range: o.range ?? range, pane: o.pane, call: o.call });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = rows.findIndex((r) => r.businessId === sel);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "j" ? 1 : -1)))];
      if (next) router.push(href({ pane: next.businessId }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dropping = rows.filter((r) => r.dropping).length;
  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader
        title="Quality"
        count={rows.length}
        actions={
          <div role="tablist" aria-label="Range" className="flex gap-1">
            {(["7d", "30d"] as const).map((r) => (
              <Link
                key={r}
                role="tab"
                aria-selected={range === r}
                href={href({ range: r, pane: business?.businessId, call: call?.callId })}
                className={["inline-flex h-ops-touch items-center rounded-sm px-ops-3 text-ops-body md:h-8", range === r ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2"].join(" ")}
              >
                {r === "7d" ? "7 days" : "30 days"}
              </Link>
            ))}
          </div>
        }
      />
      <p className="pb-ops-3 text-ops-body text-ink-2">
        <span className="font-semibold text-ink">{dropping ? `${dropping} dropping` : "None dropping"}</span> · worst score first · scores are out of 100
      </p>
      {rows.length === 0 ? (
        <EmptyState
          title="No scored calls in this range."
          action={range === "7d" ? (
            <Link href={href({ range: "30d" })} className="inline-flex min-h-11 items-center text-ops-body font-medium text-accent">Last 30 days</Link>
          ) : undefined}
        />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rows.map((r) => (
              <li key={r.businessId}>
                <Link href={href({ pane: r.businessId })} className="flex min-h-ops-touch w-full flex-col gap-0.5 px-ops-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{r.name}</span>
                    <StatusPill tone={scoreTone(r.score)}>{formatScore(r.score)}</StatusPill>
                  </span>
                  <span className="truncate text-ops-label text-ink-2">
                    {callCountLabel(r.callsTraced)}{r.topFailure ? ` · ${checkLabel(r.topFailure)}` : ""}{r.dropping ? " · dropping" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-quality-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-start font-normal">Score</th>
                <th className="hidden px-ops-3 text-start font-normal xl:table-cell">Trend</th>
                <th className="px-ops-3 text-start font-normal">Top failure</th>
                <th className="px-ops-3 text-end font-normal">Calls</th>
                <th className="hidden px-ops-3 text-end font-normal 2xl:table-cell">Last call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {rows.map((r) => (
                <tr
                  key={r.businessId}
                  aria-selected={sel === r.businessId}
                  onClick={() => router.push(href({ pane: r.businessId }))}
                  className={["h-ops-row cursor-pointer", sel === r.businessId ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="max-w-[13rem] truncate px-ops-3 text-ink">
                    <Link href={href({ pane: r.businessId })} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{r.name}</Link>
                    {r.dropping ? <span className="ms-2 text-ops-label text-ink-2">dropping</span> : null}
                  </td>
                  <td className="px-ops-3"><StatusPill tone={scoreTone(r.score)}>{formatScore(r.score)}</StatusPill></td>
                  <td className="hidden px-ops-3 xl:table-cell">{r.trend.length > 1 ? <Sparkline points={r.trend} label={`${r.name} trend`} height={20} width={72} /> : "—"}</td>
                  <td className="px-ops-3 text-ink-2">{r.topFailure ? checkLabel(r.topFailure) : r.checksLogged ? "None" : "Not logged"}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{r.callsTraced}</td>
                  <td className="hidden px-ops-3 text-end tabular-nums text-ink-2 2xl:table-cell">{when(r.lastCallAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {releases.length ? (
            <section className="mt-ops-4 hidden md:block" aria-label="Releases">
              <h2 className="flex h-ops-row items-center justify-between px-ops-3 text-ops-label text-ink-2">
                <span className="font-semibold uppercase tracking-wide">Releases</span>
                <span>average score before → after</span>
              </h2>
              <ul className="divide-y divide-hairline bg-surface">
                {releases.map((d, i) => (
                  <li key={i} className="flex h-ops-row items-center justify-between gap-2 px-ops-3 text-ops-body">
                    <span className="min-w-0 truncate text-ink">{releaseName(d)}</span>
                    <span className="tabular-nums text-ink-2">
                      {formatScore(d.before.avgScore)} → {formatScore(d.after.avgScore)}
                      <span className="ms-2 font-semibold text-ink">{formatDelta(d.before.avgScore == null || d.after.avgScore == null ? null : d.after.avgScore - d.before.avgScore)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );

  const close = () => router.push(href({}));
  const pane = call ? (
    <SplitPane open onClose={close} title={`Call · ${call.businessName}`} footer={<CallFooter base={base} call={call} back={href({ pane: call.businessId })} />}>
      <CallDetail call={call} />
      {callBusiness && callBusiness.calls.length > 1 ? (
        <section className="border-t border-hairline pt-ops-3" aria-label="Other calls">
          <h3 className="flex justify-between pb-ops-1 text-ops-label text-ink-2"><span className="font-semibold uppercase tracking-wide">Other calls</span><span>{callBusiness.name}</span></h3>
          <ul className="flex flex-col">
            {callBusiness.calls.filter((c) => c.callId !== call.callId).map((c) => (
              <li key={c.callId}>
                <Link href={href({ pane: call.businessId, call: c.callId })} className="flex h-ops-row items-center justify-between gap-2 text-ops-body hover:underline">
                  <span className="tabular-nums text-ink-2">{when(c.at)} · {formatDuration(c.durationSec)}</span>
                  <StatusPill tone={scoreTone(c.score)}>{formatScore(c.score)}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SplitPane>
  ) : business ? (
    <SplitPane
      open
      onClose={close}
      title={business.name}
      subtitle={business.dropping ? business.droppingReason : undefined}
      facts={[
        { label: "Score", value: <StatusPill tone={scoreTone(business.score)}>{formatScore(business.score)}</StatusPill> },
        { label: "Top failure", value: business.topFailure ? checkLabel(business.topFailure) : "None" },
        { label: "Calls scored", value: callCountLabel(business.callsTraced) },
        { label: "Last call", value: when(business.lastCallAt) },
        ...(business.trend.length > 1 ? [{ label: "Trend", value: <Sparkline points={business.trend} label={`${business.name} trend`} height={20} width={96} /> }] : []),
        ...business.repeatFailures.map((f) => ({ label: checkLabel(f.check), value: `on ${callCountLabel(f.calls)}` })),
      ]}
      history={[
        ...business.calls.map((c) => ({
          when: when(c.at),
          what: (
            <Link href={href({ pane: business.businessId, call: c.callId })} className="flex items-center justify-between gap-2 hover:underline">
              <span className="min-w-0 truncate">{formatDuration(c.durationSec)}{failingChecks(c.checks).length ? ` · ${failingChecks(c.checks).map(checkLabel).join(", ")}` : " · no failing checks"}</span>
              <StatusPill tone={scoreTone(c.score)}>{formatScore(c.score)}</StatusPill>
            </Link>
          ),
        })),
        ...business.couldntAnswer.map((q) => ({ when: "Couldn't answer", what: <span className="text-ink-2">“{q}”</span> })),
      ]}
      related={[
        { label: "Full quality report", href: qualityBusinessHref(base.startsWith("/admin") ? "/admin/quality" : "/dev/quality", business.businessId, range), meta: callCountLabel(business.calls.length) },
        ...(business.calls.length
          ? [(() => {
              const worst = business.calls.reduce((a, b) => ((b.score ?? 101) < (a.score ?? 101) ? b : a));
              return { label: "Worst call", href: href({ pane: business.businessId, call: worst.callId }), meta: `scored ${formatScore(worst.score)}` };
            })()]
          : []),
        { label: "Business record", href: businessPaneHref(business.businessId), meta: "summary" },
      ]}
      footer={
        <div className="flex w-full justify-between text-ops-body text-ink-2">
          <span>Open a call for its turns</span>
          <span className="tabular-nums">j / k next business</span>
        </div>
      }
    />
  ) : null;

  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout list={list} pane={pane} />
    </div>
  );
}

function CallFooter({ base, call, back }: { base: string; call: VoiceCallTrace; back: string }) {
  const full = base.startsWith("/admin") ? qualityCallHref("/admin/quality", call.callId) : qualityCallHref("/dev/quality", call.callId);
  return (
    <div className="flex w-full items-center justify-between gap-2 text-ops-body">
      <Link href={back} className="text-ink-2 hover:text-ink">← All calls for {call.businessName}</Link>
      <Link href={full} className="font-semibold text-ink hover:underline">Full trace</Link>
    </div>
  );
}

/** Call detail: facts, diagnosis, failing checks, then each turn as heard and as spoken, with timing. */
function CallDetail({ call }: { call: VoiceCallTrace }) {
  const secs = call.endedAt ? (Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000 : null;
  const failing = failingChecks(call.checks);
  return (
    <div className="flex flex-col divide-y divide-hairline text-ops-body" data-call-detail="">
      <section className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-ops-4 gap-y-ops-1 pb-ops-3">
        <span className="text-ink-2">Score</span><span><StatusPill tone={scoreTone(call.score)}>{formatScore(call.score)}</StatusPill></span>
        <span className="text-ink-2">Started</span><span className="tabular-nums text-ink">{when(call.startedAt)}</span>
        <span className="text-ink-2">Length</span><span className="tabular-nums text-ink">{formatDuration(secs)}</span>
        <span className="text-ink-2">Turns</span><span className="tabular-nums text-ink">{call.turnCount}</span>
        <span className="text-ink-2">Read</span><span className="text-ink">{diagnosisLine(call)}</span>
        {failing.length ? (<><span className="text-ink-2">Failing</span><span className="flex flex-wrap gap-1">{failing.map((c) => <StatusPill key={c} tone="warn">{checkLabel(c)} {call.checks?.[c]}</StatusPill>)}</span></>) : null}
      </section>
      <ol className="flex flex-col" aria-label="Turns">
        {call.turns.map((t) => {
          const heard = finalStt(t).heard || t.caller.text;
          const said = spokenLine(t);
          const lat = latencyMs(t);
          const hits = failingChecks(t.checks);
          return (
            <li key={t.turnIndex} className="flex flex-col gap-1 border-b border-hairline py-ops-2 last:border-b-0">
              <span className="flex justify-between gap-2 text-ops-label text-ink-2">
                <span>Turn {t.turnIndex + 1}</span>
                <span className="tabular-nums">{lat.firstAudio != null ? `${lat.firstAudio} ms to voice` : "timing not logged"}</span>
              </span>
              <span className="text-ink"><span className="text-ink-2">Caller · </span>{heard || "—"}</span>
              <span className="text-ink"><span className="text-ink-2">Assistant · </span>{said.text || said.cannedText || "Said nothing"}</span>
              {hits.length ? <span className="flex flex-wrap gap-1">{hits.map((c) => <StatusPill key={c} tone="warn">{checkLabel(c)}</StatusPill>)}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

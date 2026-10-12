"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/DeskNotice";
import { deskFieldClass } from "@/components/ui/deskChrome";
import { addFaqFromInsightAction } from "@/app/(desk)/home/insightActions";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Sheet } from "@/components/ui/Sheet";
import { inboxRecordHref } from "@/lib/inboxHref";
import { MIN_CALLS, type CallInsights as Insights, type InsightBar, type InsightSection } from "@/lib/callInsights";

const rowClass =
  "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Overview: what callers told the Business Assistant. One grouped list; each row opens a Sheet. */
export function CallInsights({ insights }: { insights: Insights }) {
  const [open, setOpen] = useState<InsightSection | null>(null);
  const { calls, days, ready, sections } = insights;

  return (
    <section aria-labelledby="insights-title" data-call-insights="" className="min-w-0 space-y-1.5">
      <div className="flex min-h-11 items-end justify-between gap-3 px-1">
        <h2 id="insights-title" className="text-meta font-medium text-ink-2">What callers told us</h2>
        <p className="text-meta text-ink-3">Last {days} days</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {!ready ? (
          <div className="px-4 py-4">
            <p className="text-body text-ink">Insights start after {MIN_CALLS} reviewed calls</p>
            <p className="mt-0.5 text-meta text-ink-2">
              {calls === 0 ? "No reviewed calls yet." : `${calls} so far.`} Each call is read after it ends, so this fills in on its own.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sections.map((s) => (
              <li key={s.id}>
                <button type="button" className={rowClass} onClick={() => setOpen(s)} aria-haspopup="dialog">
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-ink">{s.title}</span>
                    <span className={`block truncate text-meta ${s.summary ? "text-ink-2" : "text-ink-3"}`}>{s.summary ?? s.thin}</span>
                  </span>
                  <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Sheet
        open={open !== null}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open?.title ?? ""}
        description={open ? `From ${open.basis} of ${calls} calls in the last ${days} days.` : undefined}
        size="lg"
      >
        {open ? <InsightDetail section={open} /> : null}
      </Sheet>
    </section>
  );
}

function InsightDetail({ section }: { section: InsightSection }) {
  if (!section.summary || !section.bars.length) {
    return <p className="py-6 text-center text-body text-ink-2">{section.thin}</p>;
  }
  const groups = new Map<string, InsightBar[]>();
  for (const b of section.bars) groups.set(b.group ?? "", [...(groups.get(b.group ?? "") ?? []), b]);
  return (
    <div className="space-y-5 pb-2">
      {[...groups.entries()].map(([group, bars]) => (
        <div key={group || "all"} className="space-y-1.5">
          {group ? <h3 className="px-1 text-meta font-medium text-ink-2">{group}</h3> : null}
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {bars.map((b) => (
              <BarRow key={b.id} bar={b} max={Math.max(...bars.map((x) => x.count))} answerable={section.id === "unanswered"} />
            ))}
          </ul>
        </div>
      ))}
      {section.id === "unanswered" ? (
        <p className="px-1 text-meta text-ink-2">Answers you add here are used from the next call.</p>
      ) : null}
    </div>
  );
}

function BarRow({ bar, max, answerable = false }: { bar: InsightBar; max: number; answerable?: boolean }) {
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(Boolean(bar.done));
  const [adding, setAdding] = useState(false);
  const id = `bar-${bar.id.replace(/[^a-z0-9-]/gi, "")}`;
  return (
    <li>
      <button type="button" className={`${rowClass} flex-col items-stretch gap-1.5`} aria-expanded={shown} aria-controls={id} onClick={() => setShown((v) => !v)}>
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-body text-ink [overflow-wrap:anywhere]">{bar.label}</span>
          <span className="shrink-0 text-meta tabular-nums text-ink-2">{bar.count}</span>
        </span>
        <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (bar.count / Math.max(1, max)) * 100)}%` }} />
        </span>
      </button>
      {answerable ? (
        <div className="flex min-h-11 items-center justify-end px-4 pb-2">
          {done ? (
            <span className="text-meta text-ink-2">In your FAQs</span>
          ) : (
            <Button variant="tonal" size="sm" onClick={() => setAdding(true)}>
              Add answer
            </Button>
          )}
        </div>
      ) : null}
      {answerable ? <AddAnswerSheet bar={bar} open={adding} onOpenChange={setAdding} onSaved={() => setDone(true)} /> : null}
      {shown ? (
        <ul id={id} className="space-y-0.5 px-4 pb-3">
          {bar.calls.slice(0, 8).map((c) => (
            <li key={c.callId}>
              <Link href={inboxRecordHref(c.callId, { from: "home" })} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-meta text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <span className="min-w-0 truncate">{c.note ?? "Open call"}</span>
                <span className="shrink-0 tabular-nums text-ink-2">{when(c.at)}</span>
              </Link>
            </li>
          ))}
          {bar.calls.length > 8 ? <li className="px-2 pt-1 text-meta text-ink-3">And {bar.calls.length - 8} more</li> : null}
        </ul>
      ) : null}
    </li>
  );
}

/** Question filled in from the call; the owner writes the answer. */
function AddAnswerSheet({ bar, open, onOpenChange, onSaved }: { bar: InsightBar; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [question, setQuestion] = useState(bar.label);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await addFaqFromInsightAction({ question, answer });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      notify(res.message);
      onSaved();
      onOpenChange(false);
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add answer"
      description={`Asked in ${bar.count} ${bar.count === 1 ? "call" : "calls"}.`}
      footer={
        <Button variant="primary" size="lg" block pending={pending} disabled={!question.trim() || !answer.trim()} onClick={save}>
          Save answer
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <label className="block">
          <span className="text-meta font-medium text-ink-2">Question</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} className={`mt-1 ${deskFieldClass}`} />
        </label>
        <label className="block">
          <span className="text-meta font-medium text-ink-2">Callers hear</span>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={400}
            rows={4}
            placeholder="e.g. Yes, we deliver to Rongai for KSh 300."
            className={`mt-1 min-h-28 py-3 ${deskFieldClass}`}
          />
        </label>
        {error ? (
          <p role="alert" className="text-meta text-attention">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

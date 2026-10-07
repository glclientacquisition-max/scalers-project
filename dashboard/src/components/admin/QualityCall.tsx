import Link from "next/link";
import { FailChips, LatencyBar, StruckDrop, TurnFact, formatCallWhen } from "@/components/admin/QualityBits";
import { SaveAsTest } from "@/components/admin/SaveAsTest";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  bargeReason,
  cannedLabel,
  diagnosisLine,
  failingChecks,
  finalStt,
  formatScore,
  geminiRaw,
  languageLine,
  latencyMs,
  spokenLine,
  transformRows,
  type VoiceCallTrace,
  type VoiceTurnTrace,
} from "@/lib/adminQualityModel";

function TurnTimeline({ turn }: { turn: VoiceTurnTrace }) {
  const heard = finalStt(turn);
  const spoken = spokenLine(turn);
  const raw = geminiRaw(turn);
  const transforms = transformRows(turn);
  const latency = latencyMs(turn);
  const barge = bargeReason(turn);
  const failed = failingChecks(turn.checks);

  return (
    <article className="border-b border-hairline py-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium text-ink">Turn {turn.turnIndex + 1}</h3>
        <span className="text-caption tabular-nums text-ink-3">{formatCallWhen(turn.at)}</span>
        {failed.length > 0 ? <FailChips checks={turn.checks} /> : null}
      </header>
      <dl className="mt-3 space-y-3">
        <TurnFact label="Caller said">{turn.caller.text || "None"}</TurnFact>
        <TurnFact label="STT heard">
          {heard.heard || "None"}
          {heard.language ? <span className="ms-2 text-meta text-ink-3">{heard.language}</span> : null}
        </TurnFact>
        <TurnFact label="Language">{languageLine(turn)}</TurnFact>
        <TurnFact label="Gemini">{raw || "None"}</TurnFact>
        <TurnFact label="Transforms">
          {transforms.length === 0 ? (
            "None"
          ) : (
            <ul className="space-y-3">
              {transforms.map((row, index) => (
                <li key={`${row.name}-${index}`}>
                  <p className="text-meta text-ink-2">
                    {row.name}
                    {row.reason ? `. ${row.reason}` : ""}
                  </p>
                  <p className="mt-1">
                    <span className="text-caption text-ink-3">Before </span>
                    <StruckDrop before={row.before} dropped={row.dropped} />
                  </p>
                  <p className="mt-1">
                    <span className="text-caption text-ink-3">After </span>
                    {row.after || "None"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TurnFact>
        <TurnFact label="Spoken">
          <p>{spoken.text || "None"}</p>
          {spoken.cannedPath ? (
            <p className="mt-1 text-meta text-ink-2">
              Canned {cannedLabel(spoken.cannedPath)}
              {spoken.cannedText ? `. ${spoken.cannedText}` : ""}
            </p>
          ) : null}
        </TurnFact>
        <TurnFact label="Barge-in">{barge || "None"}</TurnFact>
        <TurnFact label="Latency">
          <LatencyBar ms={latency.firstAudio} />
          {latency.firstToken != null ? (
            <p className="mt-1 text-caption tabular-nums text-ink-3">
              First token {Math.round(latency.firstToken).toLocaleString("en-KE")} ms
            </p>
          ) : null}
        </TurnFact>
      </dl>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer rounded-md py-2 text-body text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-brand">
          Raw
        </summary>
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 text-caption text-ink-2">
          {JSON.stringify(turn.stages, null, 2)}
        </pre>
      </details>
    </article>
  );
}

export function QualityCall({
  trace,
  businessHref,
}: {
  trace: VoiceCallTrace;
  businessHref: string;
}) {
  const turns = trace.turns.toSorted((a, b) => a.turnIndex - b.turnIndex);

  return (
    <div className="space-y-4">
      <PageHeader
        title={trace.callId}
        meta={
          <Link href={businessHref} className="text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {trace.businessName}
          </Link>
        }
        action={<SaveAsTest call={trace} />}
      />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-title tabular-nums text-ink">{formatScore(trace.score)}</p>
        <FailChips checks={trace.checks} />
      </div>
      <p className="text-body text-ink [overflow-wrap:anywhere]">{diagnosisLine(trace)}</p>
      <ol>
        {turns.map((turn) => (
          <li key={turn.turnIndex}>
            <TurnTimeline turn={turn} />
          </li>
        ))}
      </ol>
    </div>
  );
}

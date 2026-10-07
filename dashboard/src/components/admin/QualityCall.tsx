import { FailChips, LatencyBar, QualityCrumbs, ScoreMark, StruckDrop, TurnFact, Unlogged, formatCallWhen } from "@/components/admin/QualityBits";
import { QualityRecording } from "@/components/admin/QualityRecording";
import { SaveAsTest } from "@/components/admin/SaveAsTest";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  bargeReason,
  cannedLabel,
  diagnosisLine,
  failingChecks,
  fillerLines,
  finalStt,
  geminiRaw,
  languageLine,
  latencyMs,
  spokenLine,
  toolFacts,
  transformRows,
  type VoiceCallTrace,
  type VoiceTurnTrace,
} from "@/lib/adminQualityModel";

function turnTitle(turn: VoiceTurnTrace, turns: readonly VoiceTurnTrace[]): string {
  let min = turn.turnIndex;
  for (const row of turns) {
    if (row.turnIndex < min) min = row.turnIndex;
  }
  const number = min >= 1 ? turn.turnIndex : turn.turnIndex + 1;
  return `Turn ${number}`;
}

function TurnTimeline({ turn, turns }: { turn: VoiceTurnTrace; turns: readonly VoiceTurnTrace[] }) {
  const heard = finalStt(turn);
  const spoken = spokenLine(turn);
  const raw = geminiRaw(turn);
  const transforms = transformRows(turn);
  const latency = latencyMs(turn);
  const barge = bargeReason(turn);
  const failed = turn.checks ? failingChecks(turn.checks) : [];
  const tools = toolFacts(turn);
  const fillers = fillerLines(turn);

  return (
    <article className="border-b border-hairline py-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium text-ink">{turnTitle(turn, turns)}</h3>
        {"score" in turn ? <ScoreMark score={turn.score ?? null} /> : null}
        <span className="text-caption tabular-nums text-ink-3">{formatCallWhen(turn.at)}</span>
        {turn.checks && failed.length > 0 ? <FailChips checks={turn.checks} /> : null}
      </header>
      <dl className="mt-3 space-y-3">
        <TurnFact label="Caller said">{turn.caller.text || <Unlogged />}</TurnFact>
        <TurnFact label="STT heard">
          {heard.heard || <Unlogged />}
          {heard.language ? <span className="ms-2 text-meta text-ink-3">{heard.language}</span> : null}
        </TurnFact>
        <TurnFact label="Language">
          {languageLine(turn) === "Not logged" ? <Unlogged /> : languageLine(turn)}
        </TurnFact>
        <TurnFact label="Tool">
          {tools.length === 0 ? (
            <Unlogged />
          ) : (
            <ul className="space-y-1">
              {tools.map((fact, index) => (
                <li key={`${fact.name}-${fact.result}-${index}`}>
                  {fact.name ? <span>{fact.name}. </span> : null}
                  {fact.result === "Failed" ? <span className="text-attention">Failed</span> : fact.result}
                </li>
              ))}
            </ul>
          )}
        </TurnFact>
        <TurnFact label="Filler">
          {fillers.length === 0 ? (
            <Unlogged />
          ) : (
            <ul className="space-y-1">
              {fillers.map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          )}
        </TurnFact>
        <TurnFact label="Gemini">{raw || <Unlogged />}</TurnFact>
        <TurnFact label="Transforms">
          {transforms.length === 0 ? (
            <Unlogged />
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
                    {row.after || <Unlogged />}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TurnFact>
        <TurnFact label="Spoken">
          <p>{spoken.text || <Unlogged />}</p>
          {spoken.cannedPath ? (
            <p className="mt-1 text-meta text-ink-2">
              Canned {cannedLabel(spoken.cannedPath)}
              {spoken.cannedText ? `. ${spoken.cannedText}` : ""}
            </p>
          ) : null}
        </TurnFact>
        <TurnFact label="Barge-in">{barge || <Unlogged>No</Unlogged>}</TurnFact>
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
          {JSON.stringify(turn.rawStages ?? turn.stages, null, 2)}
        </pre>
      </details>
    </article>
  );
}

export function QualityCall({
  trace,
  businessHref,
  listHref,
  showRecording = false,
}: {
  trace: VoiceCallTrace;
  businessHref: string;
  listHref: string;
  /** Live calls always pass this. Fixtures omit it. */
  showRecording?: boolean;
}) {
  const turns = trace.turns.toSorted((a, b) => a.turnIndex - b.turnIndex);

  return (
    <div className="space-y-4">
      <QualityCrumbs
        items={[
          { href: listHref, label: "Quality" },
          { href: businessHref, label: trace.businessName },
        ]}
      />
      <PageHeader title={trace.callId} action={<SaveAsTest call={trace} />} />
      <div className="flex flex-wrap items-center gap-3">
        <ScoreMark score={trace.score} />
        <FailChips checks={trace.checks} />
      </div>
      <p className="text-body text-ink [overflow-wrap:anywhere]">{diagnosisLine(trace)}</p>
      {showRecording ? (
        <section className="space-y-2">
          <h2 className="text-title text-ink">Recording</h2>
          <QualityRecording src={trace.recordingUrl ?? null} />
        </section>
      ) : null}
      <ol>
        {turns.map((turn) => (
          <li key={turn.turnIndex}>
            <TurnTimeline turn={turn} turns={turns} />
          </li>
        ))}
      </ol>
    </div>
  );
}

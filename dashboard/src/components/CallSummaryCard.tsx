import {
  buildSummarySentence,
  usefulMoodLabel,
  usefulOwnerFact,
} from "@/lib/callSummarySentence";
import { metaLabelClass } from "@/components/ui/deskChrome";

function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-3" : undefined}>
      <dt className={metaLabelClass}>{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-ink">{value}</dd>
    </div>
  );
}

export function CallSummaryCard({
  name,
  callerNumber,
  want,
  done,
  mood,
  next,
  urgent,
}: {
  name: string | null;
  callerNumber: string;
  want: string | null;
  done?: string | null;
  mood?: string | null;
  next?: string | null;
  urgent?: boolean;
}) {
  const wantText = buildSummarySentence({
    name,
    reason: want,
    callerNumber,
    urgent,
  });
  const nextText = usefulOwnerFact(next);
  const doneText = usefulOwnerFact(done);
  const moodLabel = usefulMoodLabel(mood);
  const structured = Boolean(nextText || doneText || moodLabel);

  if (!structured) {
    return <p className="mt-3 text-base leading-relaxed text-ink">{wantText}</p>;
  }

  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
      <Field label="Want" value={wantText} wide />
      {nextText ? <Field label="Do next" value={nextText} wide /> : null}
      {moodLabel ? <Field label="Mood" value={moodLabel} /> : null}
      {doneText ? <Field label="Done" value={doneText} /> : null}
    </dl>
  );
}

import { buildSummarySentence } from "@/lib/callSummarySentence";
import { metaLabelClass } from "@/components/ui/deskChrome";

const MOOD_LABEL: Record<string, string> = {
  calm: "Calm",
  rushed: "Rushed",
  confused: "Confused",
  upset: "Upset",
  angry: "Angry",
  urgent: "Urgent",
  unknown: "Unknown",
};

function displayLine(raw: string | null | undefined, empty: string): string {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || empty;
}

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
  const moodKey = String(mood || "")
    .toLowerCase()
    .trim();
  const moodKnown = Boolean(moodKey && moodKey !== "unknown");
  const structured = Boolean(done || next || moodKnown);

  if (!structured) {
    return <p className="mt-3 text-base leading-relaxed text-ink">{wantText}</p>;
  }

  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
      <Field label="Want" value={wantText} wide />
      <Field label="Do next" value={displayLine(next, "None")} wide />
      <Field
        label="Mood"
        value={MOOD_LABEL[moodKey] || MOOD_LABEL.unknown}
      />
      <Field label="Done" value={displayLine(done, "None")} />
    </dl>
  );
}

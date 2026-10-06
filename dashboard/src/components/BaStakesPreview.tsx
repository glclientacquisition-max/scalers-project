import { Stamp } from "@/components/ui/Stamp";
import type { StakeLine } from "@/lib/baStakes";

export function BaStakesPreview({
  title,
  lines,
}: {
  title: string;
  lines: StakeLine[];
}) {
  return (
    <section className="mt-8" aria-labelledby="ba-stakes-heading">
      <h3 id="ba-stakes-heading" className="text-title text-ink">
        {title}
      </h3>
      <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {lines.map((line) => (
          <li key={line.question} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-body text-ink">{line.question}</p>
              <p className="mt-0.5 text-meta text-ink-2">{line.answer}</p>
            </div>
            <Stamp tone={line.state === "live" ? "ok" : line.state === "locked" ? "attention" : "neutral"}>
              {line.state === "live" ? "Live" : line.state === "locked" ? "Locked" : "Unknown"}
            </Stamp>
          </li>
        ))}
      </ul>
    </section>
  );
}

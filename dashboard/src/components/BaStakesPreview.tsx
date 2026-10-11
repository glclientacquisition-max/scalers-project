import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import type { StakeLine } from "@/lib/baStakes";

/** Same row recipe as the capability list: title, preview line, stamp beside the preview. */
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
          <ListRow
            key={line.question}
            title={line.question}
            preview={line.answer}
            stamp={
              <Stamp tone={line.state === "live" ? "ok" : line.state === "locked" ? "attention" : "neutral"}>
                {line.state === "live" ? "Live" : line.state === "locked" ? "Needs setup" : "Unknown"}
              </Stamp>
            }
          />
        ))}
      </ul>
    </section>
  );
}

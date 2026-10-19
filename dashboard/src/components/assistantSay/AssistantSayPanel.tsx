import { ButtonLink } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import type { AssistantSayState } from "@/lib/assistantSayLoad";
import { settingsFormBodyClass } from "@/components/settingsUi";

export function AssistantSayPanel({ state }: { state: AssistantSayState }) {
  return (
    <div className={settingsFormBodyClass}>
      <p className="text-body text-ink-2">{state.intro}</p>
      <ul className="mt-4 divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {state.rows.map((row) => (
          <ListRow
            key={row.id}
            title={row.title}
            preview={row.reason}
            stamp={
              <Stamp tone={row.willSay ? "ok" : "attention"}>
                {row.willSay ? "Will say" : "Won't say"}
              </Stamp>
            }
            actions={
              <ButtonLink href={row.fixHref} variant="tonal" size="sm">
                Fix
              </ButtonLink>
            }
          />
        ))}
      </ul>
    </div>
  );
}

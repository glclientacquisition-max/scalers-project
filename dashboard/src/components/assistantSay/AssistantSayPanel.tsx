import { ButtonLink } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import type { AssistantSayState } from "@/lib/assistantSayTypes";
import { settingsFormBodyClass } from "@/components/settingsUi";
import type { ReactNode } from "react";
import { KbPendingNote } from "@/components/KbPendingNote";

export function AssistantSayPanel({
  state,
  belowList,
  pending = false,
}: {
  state: AssistantSayState;
  belowList?: ReactNode;
  /** Newer saves have not reached calls yet; the rows still show what callers hear now. */
  pending?: boolean;
}) {
  return (
    <div className={settingsFormBodyClass}>
      <p className="text-body text-ink-2">{state.intro}</p>
      <KbPendingNote pending={pending} className="mt-3" />
      <ul className="mt-4 divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {state.rows.map((row) => (
          <ListRow
            key={row.id}
            title={row.title}
            preview={row.reason}
            stampWrap={!row.isFact}
            stamp={
              <Stamp tone={row.stampTone} wrap={!row.isFact}>
                {row.stampLabel}
              </Stamp>
            }
            actions={
              row.id === "unsure" ? null : (
                <ButtonLink href={row.fixHref} variant="tonal" size="sm">
                  Fix
                </ButtonLink>
              )
            }
          />
        ))}
      </ul>
      {belowList ? <div className="mt-6">{belowList}</div> : null}
    </div>
  );
}

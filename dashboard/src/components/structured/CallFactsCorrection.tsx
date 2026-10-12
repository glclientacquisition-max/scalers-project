"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { ChoiceSheet } from "@/components/ui/ChoiceSheet";
import { notify } from "@/components/ui/DeskNotice";
import { SettingsGroup } from "@/components/settingsUi";
import { INTENTS, LOST_REASONS, OUTCOMES } from "@/lib/structuredData";
import type { StructuredResult } from "@/app/(desk)/settings/structuredActions";

export type CallFactsView = {
  intent: string | null;
  outcome: string | null;
  lost_reason: string | null;
  source: "review" | "legacy" | "owner" | null;
};

const opts = (list: { id: string; label: string }[]) => list.map((o) => ({ value: o.id, label: o.label }));

/**
 * What the call was about and how it ended, in the shared taxonomy. The owner's answer is
 * stored as trusted data (source=owner) and wins over the model on later reviews.
 */
export function CallFactsCorrection({
  callId,
  facts,
  canEdit,
  save,
}: {
  callId: string;
  facts: CallFactsView;
  canEdit: boolean;
  save: (input: { callId: string; intent: string; outcome: string; lostReason: string | null }) => Promise<StructuredResult>;
}) {
  const [intent, setIntent] = useState(facts.intent || "");
  const [outcome, setOutcome] = useState(facts.outcome || "");
  const [lost, setLost] = useState(facts.lost_reason || "");
  const [source, setSource] = useState(facts.source);
  const [pending, start] = useTransition();
  const dirty = intent !== (facts.intent || "") || outcome !== (facts.outcome || "") || lost !== (facts.lost_reason || "");
  const ready = Boolean(intent && outcome && (outcome !== "lost" || lost));

  return (
    <SettingsGroup title="About this call">
      {canEdit ? (
        <>
          <ChoiceSheet title="What they wanted" rowLabel="Wanted" label="What they wanted" value={intent} options={opts(INTENTS)} onChange={setIntent} />
          <ChoiceSheet title="How it ended" rowLabel="Result" label="How it ended" value={outcome} options={opts(OUTCOMES)} onChange={setOutcome} />
          {outcome === "lost" ? (
            <ChoiceSheet title="Why it was lost" rowLabel="Why" label="Why it was lost" value={lost} options={opts(LOST_REASONS)} onChange={setLost} />
          ) : null}
        </>
      ) : (
        <dl className="divide-y divide-hairline">
          {[["Wanted", INTENTS, intent], ["Result", OUTCOMES, outcome]].map(([k, list, v]) => (
            <div key={k as string} className="flex min-h-11 items-center justify-between px-4 py-2">
              <dt className="text-body text-ink">{k as string}</dt>
              <dd className="text-body text-ink-2">{(list as typeof INTENTS).find((o) => o.id === v)?.label || "Not set"}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        <p className="text-meta text-ink-2" aria-live="polite">
          {source === "owner" ? "Your answer. Reports use it." : "Set by your Business Assistant. Fix it if it's wrong."}
        </p>
        {canEdit ? (
          <Button
            variant="tonal"
            size="sm"
            pending={pending}
            disabled={!dirty || !ready}
            onClick={() =>
              start(async () => {
                const res = await save({ callId, intent, outcome, lostReason: outcome === "lost" ? lost : null });
                if (res.ok) setSource("owner");
                notify(res.ok ? res.message : res.error);
              })
            }
          >
            Save
          </Button>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

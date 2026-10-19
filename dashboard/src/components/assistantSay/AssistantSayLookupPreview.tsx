"use client";

import { useState, useTransition } from "react";
import { previewDeskLookupAction } from "@/app/(desk)/settings/assistantSayActions";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/Segmented";
import { SettingsGroup, SettingsStack, settingsFieldClass } from "@/components/settingsUi";
import { Stamp } from "@/components/ui/Stamp";

const KINDS = [
  { id: "price", label: "Prices" },
  { id: "hours", label: "Hours" },
  { id: "delivery", label: "Delivery" },
  { id: "pay", label: "Payment" },
] as const;

/** Shown when the tenant has no catalogue item or area to ask about yet. */
const EMPTY_HINT: Record<string, string> = {
  price: "Add a catalogue item first",
  hours: "",
  delivery: "Add a delivery area first",
  pay: "",
};

/**
 * Sample questions come from this tenant's own catalogue and areas
 * (src/knowledge/assistantSayReadiness.js previewSampleQuestions), the same
 * questions the readiness rows ask. Never another business's items.
 */
export function AssistantSayLookupPreview({
  samples,
}: {
  samples: { price: string; hours: string; delivery: string; pay: string };
}) {
  const sampleFor = (k: string) => samples[k as keyof typeof samples] || "";
  const [kind, setKind] = useState<string>("price");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewDeskLookupAction>> | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    startTransition(async () => {
      const res = await previewDeskLookupAction(kind, query || sampleFor(kind));
      setPreview(res);
    });
  }

  const result = preview && preview.ok ? preview.result : null;

  return (
    <SettingsGroup title="Test what it says">
      <div className="space-y-4 px-4 py-3">
        <SegmentedControl
          label="Lookup type"
          value={kind}
          onChange={setKind}
          items={KINDS.map((k) => ({ value: k.id, label: k.label }))}
        />
        <SettingsStack label="Sample question" htmlFor="lookup_preview_query">
          <input
            id="lookup_preview_query"
            className={settingsFieldClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={sampleFor(kind) || EMPTY_HINT[kind]}
          />
        </SettingsStack>
        <Button type="button" variant="tonal" size="sm" onClick={runPreview} disabled={pending}>
          {pending ? "Showing" : "Show answer"}
        </Button>
        {result ? (
          <div
            className="rounded-2xl border border-hairline bg-surface-2 p-4"
            data-lookup-preview=""
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-body font-medium text-ink">
                {result.willSay ? "Will say" : "Won't say"}
              </p>
              <Stamp tone={result.willSay ? "ok" : "attention"}>{result.status}</Stamp>
            </div>
            <p className="mt-2 text-body text-ink">{result.speechEn}</p>
            <p className="mt-1 text-meta text-ink-3" lang="sw">{result.speechSw}</p>
            {!result.willSay && result.reason ? (
              <p className="mt-2 text-meta text-ink-3">{result.reason}</p>
            ) : null}
          </div>
        ) : null}
        {preview && !preview.ok ? (
          <p className="text-meta text-attention">{preview.error}</p>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

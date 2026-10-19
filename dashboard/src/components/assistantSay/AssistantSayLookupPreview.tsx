"use client";

import { useState, useTransition } from "react";
import { previewDeskLookupAction } from "@/app/(desk)/settings/assistantSayActions";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/Segmented";
import { Field } from "@/components/ui/Field";
import { SettingsGroup, settingsFieldClass } from "@/components/settingsUi";
import { Stamp } from "@/components/ui/Stamp";

const KINDS = [
  { id: "price", label: "Prices" },
  { id: "hours", label: "Hours" },
  { id: "delivery", label: "Delivery" },
  { id: "pay", label: "Payment" },
] as const;

const PLACEHOLDERS: Record<string, string> = {
  price: "How much is sofa cleaning?",
  hours: "What are your opening hours?",
  delivery: "Do you deliver to Kilimani?",
  pay: "What is your till number?",
};

export function AssistantSayLookupPreview() {
  const [kind, setKind] = useState<string>("price");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewDeskLookupAction>> | null>(null);
  const [pending, startTransition] = useTransition();

  function runPreview() {
    startTransition(async () => {
      const res = await previewDeskLookupAction(kind, query || PLACEHOLDERS[kind]);
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
        <Field label="Sample question" htmlFor="lookup_preview_query">
          <input
            id="lookup_preview_query"
            className={settingsFieldClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDERS[kind]}
          />
        </Field>
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
              <p className="mt-2 text-meta text-ink-3">Reason: {result.reason}</p>
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

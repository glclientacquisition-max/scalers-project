"use client";

import { Button } from "@/components/ui/Button";
import { callToFixture, type VoiceCallTrace } from "@/lib/adminQualityModel";

/** Downloads fixture JSON. Does not write the repo or the database. */
export function SaveAsTest({ call }: { call: VoiceCallTrace }) {
  return (
    <Button
      type="button"
      variant="tonal"
      size="md"
      onClick={() => {
        const json = JSON.stringify(callToFixture(call), null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${call.callId}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }}
    >
      Save as test
    </Button>
  );
}

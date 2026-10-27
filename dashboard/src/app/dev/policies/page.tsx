import { notFound } from "next/navigation";
import { PoliciesScreen } from "@/components/policies/PoliciesScreen";
import type { Draft, Rule } from "@/lib/policyRegistry";
import { devSavePolicyTopicAction } from "./actions";

export const instant = false;

/**
 * Policies harness (no desk login). DASHBOARD_OPEN=true only. Example data, not a real business.
 * ?screen=01..06 matches /workspace/scalers/mockups/policies/policies-0N.png.
 */
const CLEANING: Record<string, Rule> = {
  cancellation: { answer: "no", allowed: false },
  booking_changes: { answer: "yes", allowed: true, notice_hours: 24 },
  no_show: { answer: "custom", mode: "custom", note: "We wait 20 minutes, then call you before we leave." },
};
const OWN = "We wait 20 minutes, then call you before we leave. A KSh 500 fee applies if we leave.";
const OWN_SW = "Tunasubiri dakika 20, kisha tunakupigia kabla ya kuondoka. Ada ya KSh 500 ikiwa tutaondoka.";
const TOO_LONG = "We wait 20 minutes, then call you before we leave. A KSh 500 fee applies if we leave, call 0712 000 000 or visit our page to rebook another day that suits you better";

type Screen = { niche: string; rules: Record<string, Rule>; topic?: string; example: string; draft?: Partial<Draft>; saved?: boolean; errors?: boolean };
const SCREENS: Record<string, Screen> = {
  "01": { niche: "cleaning", rules: CLEANING, example: "Cleaning. Not a real business." },
  "02": { niche: "cleaning", rules: CLEANING, topic: "cancellation", example: "Cleaning. Not a real business.", draft: { answer: "yes", values: { notice_hours: 24, fee: "deposit_kept" } } },
  "03": { niche: "cleaning", rules: CLEANING, topic: "cancellation", example: "Cleaning. Not a real business.", saved: true },
  "04": { niche: "cleaning", rules: CLEANING, topic: "no_show", example: "Cleaning. Not a real business.", draft: { answer: "custom", note: OWN, note_sw: OWN_SW, checked: true } },
  "05": { niche: "cleaning", rules: CLEANING, topic: "no_show", example: "Cleaning. Error state.", draft: { answer: "custom", note: TOO_LONG, checked: false }, errors: true },
  "06": { niche: "retail", rules: {}, topic: "returns", example: "Shop. Not a real business.", draft: { answer: "refund", values: { days: 7, conditions: ["unused", "receipt"] } } },
};

export default async function DevPoliciesPage({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const s = SCREENS[(await searchParams).screen ?? "01"] ?? SCREENS["01"];
  return (
    <div className="desk-theme min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl">
        <PoliciesScreen
          nicheId={s.niche}
          rules={s.rules}
          payment={{ line: "Pay by M-Pesa Till 123456 or cash after the job.", href: "#" }}
          initialTopic={s.topic ?? null}
          example={s.example}
          initialDraft={s.draft ?? null}
          initialSaved={s.saved}
          showErrors={s.errors}
          saveAction={devSavePolicyTopicAction}
        />
      </div>
    </div>
  );
}

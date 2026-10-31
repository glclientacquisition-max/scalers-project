import { Sora } from "next/font/google";
import { notFound } from "next/navigation";
import { VoiceDemoSection } from "@/components/marketing/voiceDemo/VoiceDemoSection";
import type { DemoLang } from "@/components/marketing/voiceDemo/copy";
import { isDemoState, type DemoState } from "@/components/marketing/voiceDemo/machine";
import { isAssistantPhase, isEndReason, type AssistantPhase } from "@/components/marketing/voiceDemo/protocol";

const display = Sora({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const instant = false;

export default async function VoiceDemoPreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; lang?: string; end?: string; phase?: string; caption?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const params = await searchParams;
  const state: DemoState = params.state && isDemoState(params.state) ? params.state : "idle";
  const lang: DemoLang = params.lang === "sw" ? "sw" : "en";
  const previewEnd = params.end && isEndReason(params.end) ? params.end : "user";
  const previewPhase: AssistantPhase = params.phase && isAssistantPhase(params.phase) ? params.phase : "listening";
  return (
    <main className={`${display.variable} flex min-h-dvh items-start justify-center bg-canvas px-4 py-6`}>
      <VoiceDemoSection
        key={`${state}-${lang}-${previewEnd}-${previewPhase}`}
        previewState={state}
        previewLang={lang}
        previewEnd={previewEnd}
        previewPhase={previewPhase}
        previewCaption={params.caption || ""}
      />
    </main>
  );
}

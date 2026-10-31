import { Sora } from "next/font/google";
import { notFound } from "next/navigation";
import { VoiceDemoSection } from "@/components/marketing/voiceDemo/VoiceDemoSection";
import type { DemoLang } from "@/components/marketing/voiceDemo/copy";
import { isDemoState, type DemoState } from "@/components/marketing/voiceDemo/machine";

const display = Sora({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const instant = false;

export default async function VoiceDemoPreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; lang?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const params = await searchParams;
  const state: DemoState = params.state && isDemoState(params.state) ? params.state : "idle";
  const lang: DemoLang = params.lang === "sw" ? "sw" : "en";
  return (
    <main className={`${display.variable} flex min-h-dvh items-start justify-center bg-canvas px-4 py-6`}>
      <VoiceDemoSection key={`${state}-${lang}`} previewState={state} previewLang={lang} />
    </main>
  );
}

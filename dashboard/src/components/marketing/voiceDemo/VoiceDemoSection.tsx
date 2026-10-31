import { DM_Sans } from "next/font/google";
import { VoiceDemo } from "./VoiceDemo";
import type { DemoLang } from "./copy";
import type { DemoState } from "./machine";
import type { AssistantPhase } from "./protocol";

const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-demo",
  display: "swap",
});

export function VoiceDemoSection({
  previewState,
  previewLang,
  previewEnd,
  previewPhase,
  previewCaption,
}: {
  previewState?: DemoState;
  previewLang?: DemoLang;
  previewEnd?: string;
  previewPhase?: AssistantPhase;
  previewCaption?: string;
}) {
  return (
    <div className={`${body.variable} bg-canvas`}>
      <VoiceDemo
        previewState={previewState}
        previewLang={previewLang}
        previewEnd={previewEnd}
        previewPhase={previewPhase}
        previewCaption={previewCaption}
      />
    </div>
  );
}

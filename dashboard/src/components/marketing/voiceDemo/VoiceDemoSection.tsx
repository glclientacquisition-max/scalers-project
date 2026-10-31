import { DM_Sans } from "next/font/google";
import { VoiceDemo } from "./VoiceDemo";
import type { DemoLang } from "./copy";
import type { DemoState } from "./machine";

const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-demo",
  display: "swap",
});

export function VoiceDemoSection({
  previewState,
  previewLang,
}: {
  previewState?: DemoState;
  previewLang?: DemoLang;
}) {
  return (
    <div className={`${body.variable} bg-canvas`}>
      <VoiceDemo previewState={previewState} previewLang={previewLang} />
    </div>
  );
}

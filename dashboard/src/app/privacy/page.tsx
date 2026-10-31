import { DM_Sans, Sora } from "next/font/google";
import Link from "next/link";

const display = Sora({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-demo",
  display: "swap",
});

export default function PrivacyPage() {
  return (
    <main className={`${display.variable} ${body.variable} min-h-dvh bg-canvas px-4 py-8 text-ink`}>
      <article className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <h1 className="font-display text-page tracking-tight">Privacy</h1>
        <p className="font-demo text-body">
          Scalers is the controller for this voice demo. The demo is voluntary. You start it yourself.
        </p>
        <p className="font-demo text-body">
          We use your live voice to hear the question and speak a reply. The audio goes to speech providers for that
          reply. We do not keep the recording or the words.
        </p>
        <p className="font-demo text-body">End stops the demo at once. You can close the page instead.</p>
        <p className="font-demo text-body">
          Scalers ndiye mdhibiti wa onyesho hili la sauti. Ni hiari. Sauti yako inatumika kusikia swali na kujibu. Sauti
          inaenda kwa watoa huduma wa sauti. Hatutunzi rekodi wala maneno. Maliza inasimamisha mara moja.
        </p>
        <p className="font-demo text-meta text-ink-2">Notice version 2026-10-31.</p>
        <Link href="/" className="font-demo inline-flex min-h-11 items-center text-body text-ink underline">
          Back
        </Link>
      </article>
    </main>
  );
}

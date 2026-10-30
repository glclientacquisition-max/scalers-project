import Link from "next/link";
import { Stamp } from "@/components/ui/Stamp";

/**
 * Home sections under the hero. Few words, one idea per section, real claims only.
 * The inbox is a drawn example, not a capture of a real desk.
 */

const INBOX: ReadonlyArray<{ who: string; state: string; tone: "attention" | "ok"; line: string; when: string }> = [
  { who: "New caller", state: "Call back", tone: "attention", line: "Asked about Saturday", when: "Just now" },
  { who: "Caller", state: "Answered", tone: "ok", line: "House cleaning", when: "Today" },
];

const STEPS: readonly string[] = ["Request access", "Add your services and hours", "Forward your calls"];

const QUESTIONS: ReadonlyArray<[string, string]> = [
  ["What do callers hear?", "A voice with your prices, hours and answers."],
  ["What if it doesn't know?", "It says you'll call back. It never invents a price."],
  ["Who sees my calls?", "You, and teammates on your Desk."],
];

const h2 = "font-display text-2xl tracking-tight text-ink sm:text-3xl";
const card = "rounded-2xl border border-hairline bg-surface";

/** The three moments the assistant answers in. Words come from the page copy (home or a trade page). */
export function LandingMoments({ items }: { items: readonly string[] }) {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-moments" data-landing-section="moments">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-moments" className={h2}>
          When it answers
        </h2>
        <ul className={`mt-5 max-w-xl px-5 ${card}`}>
          {items.map((m) => (
            <li key={m} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-3 last:border-0">
              <span className="text-base text-ink">{m}</span>
              <span className="text-sm font-medium text-[var(--landing-cta)]">Picks up</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LandingReach() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-reach" data-landing-section="reach">
      <div className="mx-auto grid max-w-desk gap-5 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <h2 id="landing-reach" className={h2}>
            What reaches you
          </h2>
          <p className="mt-3 max-w-md text-base leading-relaxed text-ink-2">SMS, WhatsApp, and email. The call is in your inbox.</p>
        </div>
        <div className={`min-w-0 ${card}`} data-landing-inbox="" aria-hidden>
          <ul>
            {INBOX.map((row) => (
              <li key={row.state} className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-medium text-ink-2">
                  {row.who.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-base font-medium text-ink">{row.who}</span>
                    <span className="shrink-0 text-meta text-ink-3">{row.when}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-ink-2">{row.line}</span>
                    <Stamp tone={row.tone}>{row.state}</Stamp>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function LandingHowItWorks() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-how" data-landing-section="how">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-how" className={h2}>
          How to start
        </h2>
        <ol className="mt-5 grid max-w-xl gap-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-4">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--landing-glow)] text-sm font-semibold tabular-nums text-[var(--landing-cta)]"
              >
                {i + 1}
              </span>
              <span className="text-base text-ink">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function LandingKeepNumber() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-number" data-landing-section="number">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-number" className={h2}>
          Keep your number
        </h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-2">
          Forward missed calls. To stop, dial <span className="font-semibold tabular-nums text-ink">##002#</span>.
        </p>
      </div>
    </section>
  );
}

export function LandingPackages() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-packages" data-landing-section="packages">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-packages" className={h2}>
          Pricing
        </h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-2">Monthly packages in KES.</p>
        <Link
          href="/pricing"
          className="mt-2 inline-flex min-h-11 items-center text-base font-semibold text-[var(--landing-cta)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          See pricing
        </Link>
      </div>
    </section>
  );
}

export function LandingQuestions() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-questions" data-landing-section="questions">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-questions" className={h2}>
          Questions
        </h2>
        <div className="mt-4 max-w-xl divide-y divide-hairline border-y border-hairline">
          {QUESTIONS.map(([q, a]) => (
            <details key={q} className="group py-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-ink focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="text-xl text-ink-2 transition-transform group-open:rotate-45 motion-reduce:transition-none">
                  +
                </span>
              </summary>
              <p className="pb-3 text-base leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

import Image from "next/image";
import Link from "next/link";

/**
 * Home sections under the hero. Real claims only: every line here is something the product does today.
 * Screens are anonymised Desk captures (fixture data, no client names or numbers).
 */

const MOMENTS: ReadonlyArray<[string, string]> = [
  ["On a job", "Hands busy, phone in your pocket."],
  ["On another call", "The second caller still gets an answer."],
  ["After closing", "Evening and weekend calls are answered too."],
  ["Phone off or no signal", "Forwarded calls still reach your Business Assistant."],
];

const HOW: ReadonlyArray<{ src: string; alt: string; w: number; h: number; title: string; line: string }> = [
  {
    src: "/landing/how-prices.webp",
    alt: "Desk list of services with prices, such as Deep clean, KSh 6,000 to 12,000 per job",
    w: 585,
    h: 468,
    title: "Tell it your prices and hours",
    line: "Add what you sell, your prices and when you're open. Add many at once.",
  },
  {
    src: "/landing/how-call.webp",
    alt: "A call summary on the Desk: the caller wants house cleaning tomorrow at 9am",
    w: 585,
    h: 600,
    title: "It answers your calls",
    line: "Your Business Assistant answers with your prices and takes the caller's details.",
  },
  {
    src: "/landing/how-inbox.webp",
    alt: "Desk inbox with two callers, one marked Call back and one ready to confirm",
    w: 585,
    h: 393,
    title: "You get the details",
    line: "You get an SMS, and the call waits in your inbox so you can call back.",
  },
];

const TRUST: readonly string[] = [
  "It uses only your prices, hours and answers.",
  "If it doesn't know, it tells the caller you'll call back.",
  "It never makes up a price.",
];

const QUESTIONS: ReadonlyArray<[string, string]> = [
  [
    "What do callers hear?",
    "A calm voice that answers for your business. It uses only what you've told it, and takes the caller's name and what they need.",
  ],
  ["What does it cost?", "A monthly package with call minutes and messages included. See Pricing for the packages."],
  [
    "How long does setup take?",
    "Five short steps. Prices and common questions can wait. You can add them later from your Desk.",
  ],
  ["Can I turn it off?", "Yes. Dial ##002# on your phone to stop forwarding. Your phone rings as before."],
  ["Who sees my calls?", "You, and the teammates you add to your Desk."],
  ["Do I need a new number?", "No. Keep your number and forward calls you don't pick up, or share a Scalers number."],
];

const h2 = "font-display text-2xl tracking-tight text-ink sm:text-3xl";

export function LandingMoments() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-moments" data-landing-section="moments">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-moments" className={h2}>
          When you can&apos;t pick up
        </h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {MOMENTS.map(([title, line]) => (
            <li key={title} className="rounded-2xl border border-hairline bg-surface px-4 py-3">
              <p className="text-base font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-sm text-ink-2">{line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LandingHowItWorks() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-how" data-landing-section="how">
      <div className="mx-auto max-w-desk">
        <h2 id="landing-how" className={h2}>
          How it works
        </h2>
        <ol className="mt-6 grid gap-8 lg:grid-cols-3">
          {HOW.map((step, i) => (
            <li key={step.src} className="min-w-0">
              <p className="text-sm font-semibold tabular-nums text-ink-2">Step {i + 1}</p>
              <p className="mt-1 text-lg font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-base leading-relaxed text-ink-2">{step.line}</p>
              <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface">
                <Image src={step.src} alt={step.alt} width={step.w} height={step.h} sizes="(min-width: 1024px) 30vw, 100vw" className="h-auto w-full" />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function LandingTrust() {
  return (
    <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-trust" data-landing-section="trust">
      <div className="mx-auto max-w-desk rounded-2xl border border-hairline bg-surface px-5 py-6 sm:px-8">
        <h2 id="landing-trust" className={h2}>
          What it says, and what it won&apos;t
        </h2>
        <ul className="mt-4 space-y-2">
          {TRUST.map((line) => (
            <li key={line} className="flex gap-2 text-base text-ink">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--landing-cta)]" />
              {line}
            </li>
          ))}
        </ul>
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
          Forward the calls you don&apos;t pick up, or share a Scalers number. We give you the code to dial. Forwarding is
          tested on Safaricom and Airtel.
        </p>
        <p className="mt-3 text-base text-ink">
          To turn it off, dial <span className="font-semibold tabular-nums">##002#</span>.
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
          Packages
        </h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-2">
          Pay for a monthly package with minutes and messages included. Extra minutes when you need them.
        </p>
        <Link
          href="/pricing"
          className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-[var(--landing-cta)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
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
        <div className="mt-4 divide-y divide-hairline border-y border-hairline">
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

const STEPS = [
  {
    title: "Scalers number",
    text: "We give you a unique Scalers number. Prefer forwarding missed, busy, and off calls from your actual business phone. We walk you through it. Or publish that Scalers number if you want the assistant on every call.",
  },
  {
    title: "Business knowledge",
    text: "You enter hours, services, policies, and the questions customers ask. Answers use what your business knows.",
  },
  {
    title: "Answer",
    text: "When you cannot pick up, the assistant answers from that knowledge.",
  },
  {
    title: "Notify",
    text: "You hear about the work by SMS, WhatsApp, and email.",
  },
  {
    title: "Scalers app",
    text: "Needs you, return calls, and contacts land in the Scalers app.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-28 border-t border-hairline bg-surface" aria-labelledby="how-title">
      <div className="mx-auto max-w-desk px-4 py-16 sm:px-6 lg:py-20">
        <h2 id="how-title" className="max-w-[18ch] font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          How it works
        </h2>
        <ol className="mt-10 max-w-3xl">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[2.75rem_1fr] gap-4 border-t border-hairline py-5">
              <span className="font-display text-title tabular-nums text-accent" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3 className="font-display text-title text-ink">{step.title}</h3>
                <p className="mt-1 max-w-[65ch] text-base leading-7 text-ink-2">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

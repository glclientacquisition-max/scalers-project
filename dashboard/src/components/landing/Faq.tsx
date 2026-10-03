import { LandingCta } from "@/components/landing/LandingCta";

const QUESTIONS = [
  {
    q: "What is live today?",
    a: "A business assistant on a unique Scalers number. It answers from the business knowledge you enter. You are notified by SMS, WhatsApp, and email. The work lands in the Scalers app.",
  },
  {
    q: "Who is it for?",
    a: "Service businesses first, including people who go to the customer. Shops second.",
  },
  {
    q: "Where do the answers come from?",
    a: "From your business knowledge in the app: hours, services, policies, and the questions you have already answered.",
  },
  {
    q: "How am I notified?",
    a: "By SMS, WhatsApp, and email. The same work shows up in the Scalers app.",
  },
  {
    q: "Which number do callers use?",
    a: "We give you a unique Scalers number. Prefer forwarding missed, busy, and off calls from your business phone. We walk you through that. You can also publish the Scalers number so the assistant takes every call.",
  },
  {
    q: "What does it cost?",
    a: "Prices are not published. Access is by invite during the private beta.",
  },
  {
    q: "How do I join?",
    a: "Request beta access. Signup is how you join the private beta.",
  },
];

export function Faq() {
  return (
    <section className="border-t border-hairline" aria-labelledby="faq-title">
      <div className="mx-auto max-w-desk px-4 py-16 sm:px-6 lg:py-20">
        <h2 id="faq-title" className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          Questions
        </h2>
        <div className="mt-8 max-w-3xl border-t border-hairline">
          {QUESTIONS.map((item) => (
            <details key={item.q} className="border-b border-hairline">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-4 py-3 text-base font-medium text-ink after:ml-auto after:text-title after:text-ink-3 after:content-['+'] open:after:content-['-'] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
                {item.q}
              </summary>
              <p className="max-w-[65ch] pb-4 text-base leading-7 text-ink-2">{item.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-10">
          <LandingCta size="lg" />
        </div>
      </div>
    </section>
  );
}

import { LandingCta } from "@/components/landing/LandingCta";

const QUESTIONS = [
  {
    q: "What is live today?",
    a: "Answering missed, busy, and after-hours calls on your business number. Train for the facts you enter. Desk for the inbox. WhatsApp or email when a caller needs a person.",
  },
  {
    q: "Who is it for?",
    a: "Service businesses first, including people who go to the customer. Shops second. We started in Kenya.",
  },
  {
    q: "What if the caller needs a person?",
    a: "You get a WhatsApp or email. The call stays in Desk so you can call them back.",
  },
  {
    q: "How do I join?",
    a: "Request beta access. Scalers is in private beta, by invite.",
  },
  {
    q: "Where do the answers come from?",
    a: "From the facts you enter in Train: hours, services, and what the line may say.",
  },
  {
    q: "What does it cost?",
    a: "Package prices are not published here. Access is private beta, by invite.",
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

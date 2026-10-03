import { LandingCta } from "@/components/landing/LandingCta";

const OUTCOMES = [
  {
    title: "You stay with the customer",
    text: "The business still answers while you are on a job or after you have closed.",
  },
  {
    title: "Callers hear your business",
    text: "Hours, services, and policies come from what you entered.",
  },
  {
    title: "The work is waiting for you",
    text: "You open the Scalers app and see what needs you, already notified.",
  },
];

export function Outcomes() {
  return (
    <section className="border-t border-hairline" aria-labelledby="outcomes-title">
      <div className="mx-auto max-w-desk px-4 py-16 sm:px-6 lg:py-20">
        <h2 id="outcomes-title" className="max-w-[16ch] font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          What changes for you
        </h2>
        <div className="mt-10 max-w-3xl divide-y divide-hairline border-y border-hairline">
          {OUTCOMES.map((row) => (
            <div key={row.title} className="py-5">
              <h3 className="font-display text-title text-ink">{row.title}</h3>
              <p className="mt-1 max-w-[65ch] text-base leading-7 text-ink-2">{row.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10">
          <LandingCta size="lg" />
        </div>
      </div>
    </section>
  );
}

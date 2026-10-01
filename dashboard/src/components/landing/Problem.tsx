const SITUATIONS = [
  {
    label: "On the job",
    text: "You are on site, or the handset is in another room.",
  },
  {
    label: "Busy",
    text: "You are already with a customer.",
  },
  {
    label: "After hours",
    text: "The business is shut. The phone still rings.",
  },
];

export function Problem() {
  return (
    <section className="border-t border-hairline" aria-labelledby="problem-title">
      <div className="mx-auto max-w-desk px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-[65ch]">
          <h2 id="problem-title" className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
            The phone rings while you are on the job.
          </h2>
          <p className="mt-4 text-base leading-7 text-ink-2">
            Service businesses first, then shops. The call does not wait until you are free.
          </p>
        </div>
        <dl className="mt-10 max-w-3xl divide-y divide-hairline border-y border-hairline">
          {SITUATIONS.map((row) => (
            <div key={row.label} className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:items-baseline sm:gap-6">
              <dt className="font-display text-title text-ink">{row.label}</dt>
              <dd className="text-base leading-7 text-ink-2">{row.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

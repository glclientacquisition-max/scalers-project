const LIVE = [
  "Answering on your business number",
  "Train, with the facts you enter",
  "Desk inbox for what needs you",
  "WhatsApp or email when a caller needs a person",
];

export function Proof() {
  return (
    <section className="border-t border-hairline bg-surface" aria-labelledby="proof-title">
      <div className="mx-auto max-w-desk px-4 py-16 sm:px-6 lg:py-20">
        <p className="text-base text-ink-2">Private beta. Invite only.</p>
        <h2 id="proof-title" className="mt-3 max-w-[18ch] font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          What is live
        </h2>
        <p className="mt-4 max-w-[65ch] text-base leading-7 text-ink-2">
          We started with service businesses in Kenya. Shops follow. Join by invite while the beta is open.
        </p>
        <ul className="mt-8 max-w-3xl divide-y divide-hairline border-y border-hairline">
          {LIVE.map((item) => (
            <li key={item} className="py-4 text-base leading-7 text-ink">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

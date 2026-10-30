/** Words that change between the home page and a trade page. Same skeleton, same real-only rules. */
export type LandingCopy = {
  key: "home" | "cleaning";
  /** Label under the wordmark. */
  context: string;
  h1: string;
  sub: string;
  /** Hero call card: what the caller asked. */
  ask: string;
  moments: ReadonlyArray<readonly [string, string]>;
  finalHeading: string;
};

export const HOME_COPY: LandingCopy = {
  key: "home",
  context: "Home",
  h1: "Your calls get answered, even when you can't.",
  sub: "On a job, on another call, or closed for the night. Your Business Assistant answers with your prices and hours, then texts you the details.",
  ask: "They asked for a booking.",
  moments: [
    ["On a job", "Hands busy, phone in your pocket."],
    ["On another call", "The second caller still gets an answer."],
    ["After closing", "Evening and weekend calls are answered too."],
    ["Phone off or no signal", "Forwarded calls still reach your Business Assistant."],
  ],
  finalHeading: "Stop losing jobs to missed calls.",
};

export const CLEANING_COPY: LandingCopy = {
  key: "cleaning",
  context: "Cleaning",
  h1: "Never lose a cleaning job to a missed call.",
  sub: "You're mid-clean with gloves on. Your Business Assistant answers with your prices, takes the visit request, then texts you the details.",
  ask: "They asked for a deep clean on Saturday.",
  moments: [
    ["Mid-clean", "Gloves on, phone in the bag."],
    ["Driving between jobs", "The caller still gets an answer."],
    ["On a quote visit", "New callers don't wait for you to finish."],
    ["After hours", "Evening calls for tomorrow's jobs are answered too."],
  ],
  finalHeading: "Answer every cleaning call.",
};

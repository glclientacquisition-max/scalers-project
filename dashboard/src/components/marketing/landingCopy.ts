/** Words that change between the home page and a trade page. Same skeleton, same real-only rules. */
export type LandingCopy = {
  key: string;
  /** Label under the wordmark. */
  context: string;
  h1: string;
  sub: string;
  /** Hero call card: what the caller asked. */
  ask: string;
  /** "When it answers" rows: busy, after hours, on another call, in the trade's words. */
  moments: readonly string[];
  finalHeading: string;
};

export const HOME_COPY: LandingCopy = {
  key: "home",
  context: "Home",
  h1: "Your 24-hour Business Assistant.",
  sub: "Answers your calls when you're busy, closed, or on another call.",
  ask: "They asked for a booking.",
  moments: ["You're busy", "After hours", "On another call"],
  finalHeading: "Stop losing jobs to missed calls.",
};

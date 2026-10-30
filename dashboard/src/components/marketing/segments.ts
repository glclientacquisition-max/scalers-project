import type { LandingCopy } from "@/components/marketing/landingCopy";

/** One public segment. Slugs are the three real business types. Examples are not their own pages. */
export type Segment = {
  slug: string;
  name: string;
  examples: readonly string[];
  hero: string;
  sub: string;
  pains: readonly [string, string, string];
  /** Words on the hero call card. What the caller said, not a booking the product makes. */
  ask: string;
  example: { caller: string; does: string };
  finalHeading: string;
  cta: string;
};

export const SEGMENTS: readonly Segment[] = [
  {
    slug: "home-services",
    name: "Home services",
    examples: ["Cleaning", "Plumbing"],
    hero: "Answer calls from the job.",
    sub: "Answers when you're on a job, closed, or on another call.",
    pains: ["On a job", "After hours", "On another call"],
    ask: "They asked for a Saturday clean.",
    example: {
      caller: "A caller asks for a Saturday clean.",
      does: "The assistant answers, then sends you the name, number, and what they asked.",
    },
    finalHeading: "Missed calls miss jobs.",
    cta: "Request access",
  },
  {
    slug: "shop",
    name: "Shop",
    examples: [],
    hero: "Answer the shop phone.",
    sub: "Answers when you're with a customer, closed, or on another call.",
    pains: ["With a customer", "After hours", "On another call"],
    ask: "They asked if you're open Saturday.",
    example: {
      caller: "A caller asks if you're open Saturday.",
      does: "The assistant answers from your hours, then sends you their name and number.",
    },
    finalHeading: "The shop phone still gets answered.",
    cta: "Request access",
  },
  {
    slug: "other",
    name: "Other business",
    examples: [],
    hero: "Answer when you can't.",
    sub: "Answers when you're busy, closed, or on another call.",
    pains: ["You're busy", "After hours", "On another call"],
    ask: "They asked you to call them back.",
    example: {
      caller: "A caller asks you to call them back.",
      does: "The assistant takes the message and sends you the name, number, and what they asked.",
    },
    finalHeading: "Missed calls still reach you.",
    cta: "Request access",
  },
];

export function segmentBySlug(slug: string): Segment | null {
  return SEGMENTS.find((segment) => segment.slug === slug) ?? null;
}

export function segmentCopy(segment: Segment): LandingCopy {
  return {
    key: segment.slug,
    context: segment.name,
    h1: segment.hero,
    sub: segment.sub,
    ask: segment.ask,
    moments: segment.pains,
    finalHeading: segment.finalHeading,
  };
}

/** "Cleaning and plumbing, for example." */
export function exampleLine(examples: readonly string[]): string {
  if (examples.length === 0) return "";
  if (examples.length === 1) return `${examples[0]}, for example.`;
  if (examples.length === 2) return `${examples[0]} and ${examples[1]}, for example.`;
  return `${examples.slice(0, -1).join(", ")}, and ${examples[examples.length - 1]}, for example.`;
}

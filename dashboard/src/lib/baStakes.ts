import {
  parseCaptureHours,
  type CaptureHours,
  type CaptureProduct,
  type CaptureService,
} from "./outcomeGates";

export type StakeState = "live" | "unknown" | "locked";

export type StakeLine = {
  question: string;
  state: StakeState;
  answer: string;
};

const UNKNOWN = "I'll check with the owner";

function live(question: string, answer: string): StakeLine {
  return { question, state: "live", answer };
}

function unknown(question: string): StakeLine {
  return { question, state: "unknown", answer: UNKNOWN };
}

function locked(question: string): StakeLine {
  return { question, state: "locked", answer: "Locked" };
}

function saturdayLine(schedule: CaptureHours | null): StakeLine {
  const question = "Are you open on Saturday?";
  const sat = schedule?.days.sat;
  if (!schedule) return unknown(question);
  if (sat?.open && sat.close) return live(question, `Yes, ${sat.open}-${sat.close}`);
  return live(question, "Closed on Saturday");
}

export function shopStakes(input: {
  products: CaptureProduct[];
  hoursText?: string;
  schedule?: CaptureHours | null;
  holdsAllowed?: boolean;
}): StakeLine[] {
  const question = "How much is a charger?";
  const charger = input.products.find((product) =>
    /charger/i.test(String(product.name || ""))
  );
  const price = String(charger?.price || "").trim();
  const priceLine = charger && price ? live(question, price) : unknown(question);
  const hours = input.schedule || parseCaptureHours(input.hoursText || "");
  const hold = input.holdsAllowed
    ? live("Can you hold this until evening?", "Yes, we can hold it.")
    : locked("Can you hold this until evening?");
  return [priceLine, saturdayLine(hours), hold];
}

export function homeStakes(input: {
  services: CaptureService[];
  coverage?: string;
}): StakeLine[] {
  const cover = String(input.coverage || "").trim();
  const coverageLine = cover
    ? live("Do you cover Kilimani?", cover)
    : unknown("Do you cover Kilimani?");
  const visits = input.services
    .map((service) => service.site_visit_required)
    .filter((visit): visit is boolean => visit === true || visit === false);
  let visitLine: StakeLine;
  if (!visits.length) visitLine = unknown("Is a site visit required?");
  else if (visits.every(Boolean)) visitLine = live("Is a site visit required?", "Yes");
  else if (visits.every((visit) => visit === false)) {
    visitLine = live("Is a site visit required?", "No");
  } else visitLine = live("Is a site visit required?", "Depends on the job");
  return [
    coverageLine,
    visitLine,
    locked("Can you book me in for Thursday?"),
  ];
}

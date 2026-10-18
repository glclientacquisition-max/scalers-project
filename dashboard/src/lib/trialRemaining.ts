import { minuteMeter } from "./minutes";

/** Trial ends at whichever hits zero first: days on the clock, or included minutes. */

export function trialRemaining(input: {
  now: Date;
  trialEndsAt: string | null;
  secondsUsed: number;
  minutesIncluded: number;
}): { daysLeft: number; minutesLeft: number; ended: boolean; text: string } {
  const meter = minuteMeter(input.minutesIncluded, input.secondsUsed);
  const minutesLeft = meter.left;
  let daysLeft = 0;
  if (input.trialEndsAt) {
    const end = Date.parse(input.trialEndsAt);
    if (Number.isFinite(end)) {
      const left = end - input.now.getTime();
      daysLeft = left <= 0 ? 0 : Math.ceil(left / 86_400_000);
    }
  }
  if (daysLeft <= 0 || minutesLeft <= 0) {
    return { daysLeft: 0, minutesLeft, ended: true, text: "Trial ended" };
  }
  return {
    daysLeft,
    minutesLeft,
    ended: false,
    text: `Trial: ${daysLeft} days or ${meter.underOneMinute ? "under 1 min" : `${minutesLeft} minutes`} left`,
  };
}

export function usageCapNotice(input: {
  isBeta: boolean;
  onDemand: boolean;
  minutesIncluded: number;
  minutesLeft: number;
  smsIncluded: number;
  smsLeft: number;
  emailIncluded: number;
  emailLeft: number;
  waIncluded: number;
  waLeft: number;
}): string | null {
  if (input.isBeta || input.onDemand) return null;
  const minutesOver = input.minutesIncluded > 0 && input.minutesLeft <= 0;
  const smsOver = input.smsIncluded > 0 && input.smsLeft <= 0;
  const emailOver = input.emailIncluded > 0 && input.emailLeft <= 0;
  const waOver = input.waIncluded > 0 && input.waLeft <= 0;
  if (!minutesOver && !smsOver && !emailOver && !waOver) return null;
  if (minutesOver && smsOver) {
    return "Included used. Calls answer. Tenant SMS stopped. No charge.";
  }
  if (minutesOver) return "Included minutes used. Calls answer. No charge.";
  if (smsOver) return "Included SMS used. Tenant SMS stopped.";
  return "Included used.";
}

export function homeMinuteStatus(input: {
  isBeta: boolean;
  onDemand: boolean;
  minutesIncluded: number;
  minutesLeft: number;
}): "On-demand" | "Answering" | null {
  if (input.isBeta) return null;
  if (!(input.minutesIncluded > 0 && input.minutesLeft <= 0)) return null;
  return input.onDemand ? "On-demand" : "Answering";
}

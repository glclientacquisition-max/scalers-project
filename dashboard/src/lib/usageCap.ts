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
  const minutesOver = input.minutesIncluded > 0 && input.minutesLeft <= 0;
  const smsOver = input.smsIncluded > 0 && input.smsLeft <= 0;
  const emailOver = input.emailIncluded > 0 && input.emailLeft <= 0;
  const waOver = input.waIncluded > 0 && input.waLeft <= 0;
  // Beta never stops calls at the package cap (#631). Say what is true.
  if (input.isBeta) {
    return minutesOver ? "Included minutes used. During beta, calls keep working and nothing is charged." : null;
  }
  if (!minutesOver && !smsOver && !emailOver && !waOver) return null;
  // Extra usage on: nothing stops, the overage is billed.
  if (input.onDemand) {
    if (minutesOver && smsOver) return "Included minutes and SMS used. Extra usage is billed on your next invoice.";
    if (minutesOver) return "Included minutes used. Extra minutes are billed on your next invoice.";
    if (smsOver) return "Included SMS used. Extra SMS are billed on your next invoice.";
    return "Included alerts used. Extra alerts are billed on your next invoice.";
  }
  if (minutesOver && smsOver) {
    return "Included minutes and SMS used. Calls and SMS to callers have stopped.";
  }
  if (minutesOver) return "Included minutes used. Calls have stopped.";
  if (smsOver) return "Included SMS used. SMS to callers have stopped.";
  return "Included alerts used.";
}

export function homeMinuteStatus(input: {
  isBeta: boolean;
  onDemand: boolean;
  minutesIncluded: number;
  minutesLeft: number;
}): "Extra usage" | "Calls stopped" | null {
  if (!(input.minutesIncluded > 0 && input.minutesLeft <= 0)) return null;
  // Beta never stops at the cap (#631).
  if (input.isBeta) return null;
  if (!input.onDemand) return "Calls stopped";
  return "Extra usage";
}

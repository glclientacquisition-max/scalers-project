/** Owner copy for a caller SMS that did not go out (sendRecordedDeskCallerSms result). */
export function deskSmsSendError(sent: { reason?: string; message?: string }): string {
  if (sent.message) return sent.message;
  if (sent.reason === "sms_not_configured") return "Texting is not set up for this business yet.";
  if (sent.reason === "sms_allowance_exhausted") {
    return "Included SMS used. Enable on-demand on Usage.";
  }
  if (sent.reason === "instance_already_sent") return "Already sent.";
  return "SMS failed.";
}

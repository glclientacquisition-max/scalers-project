/** Alert phone write. An empty submit clears. Never substitute the stored number. */
export function alertPhoneWrite(submitted: string): string {
  return String(submitted ?? "").trim();
}

export function alertsPersistMatchesSubmit(input: {
  submittedPhone: string;
  writtenPhone: string;
  submittedEmail: string;
  writtenEmail: string | null;
}): boolean {
  const phone = String(input.submittedPhone ?? "").trim();
  const email = String(input.submittedEmail ?? "").trim().toLowerCase();
  const writtenEmail = String(input.writtenEmail ?? "").trim().toLowerCase();
  return String(input.writtenPhone ?? "").trim() === phone && writtenEmail === email;
}

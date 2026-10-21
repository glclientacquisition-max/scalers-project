/** Password reset: new password rules and the short-lived recovery marker. Pure, no server imports. */

/**
 * Set by /auth/callback after a reset link signs someone in. /reset-password only lets a person
 * set a new password without the old one while this is present, so an ordinary signed-in
 * session cannot change the password from that page.
 */
export const RECOVERY_COOKIE = "scalers_recovery";
export const RECOVERY_COOKIE_SECONDS = 15 * 60;

export const recoveryCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: RECOVERY_COOKIE_SECONDS,
};

/** Query flag /home reads to show a one-time toast after a reset. */
export const PASSWORD_UPDATED_NOTICE = "password-updated";
export const PASSWORD_UPDATED_PATH = `/home?notice=${PASSWORD_UPDATED_NOTICE}`;

export type NewPasswordError = { field: "password" | "confirm"; message: string };

/** Same length rules as signup (8 to 72 characters), plus the two entries must match. */
export function newPasswordError(password: string, confirm: string): NewPasswordError | null {
  if (password.length < 8) return { field: "password", message: "Use at least 8 characters." };
  if (password.length > 72) return { field: "password", message: "Use 72 characters or fewer." };
  if (password !== confirm) return { field: "confirm", message: "The two passwords don't match." };
  return null;
}

/** Supabase updateUser errors in plain words. */
export function updatePasswordErrorMessage(raw: string | null | undefined): NewPasswordError | { field?: undefined; message: string } {
  const m = String(raw || "");
  if (/different from the old|same.?password/i.test(m)) return { field: "password", message: "Pick a password you haven't used here before." };
  if (/weak|at least|characters/i.test(m)) return { field: "password", message: "Pick a longer password with a mix of letters and numbers." };
  if (/session|jwt|expired|not authenticated|auth session missing/i.test(m)) return { message: "This reset link has expired. Send yourself a new one." };
  return { message: "Couldn't save your new password. Try again." };
}

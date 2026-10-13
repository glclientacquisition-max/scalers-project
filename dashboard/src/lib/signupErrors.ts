/** Map Supabase Auth messages to owner-facing copy. Pure. */
export function signupErrorMessage(raw: string): {
  message: string;
  field?: "email" | "password";
  signIn?: boolean;
} {
  const m = String(raw || "").toLowerCase();
  if (m.includes("already registered") || m.includes("already exists")) {
    return { message: "This email already has an account.", field: "email", signIn: true };
  }
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) {
    return { message: "Too many attempts. Wait a minute and try again." };
  }
  if (m.includes("password")) {
    return { message: "Choose a stronger password: at least 8 characters, not a common one.", field: "password" };
  }
  if (m.includes("email") && (m.includes("invalid") || m.includes("valid"))) {
    return { message: "Enter a valid email address.", field: "email" };
  }
  return { message: "Something went wrong. Try again." };
}

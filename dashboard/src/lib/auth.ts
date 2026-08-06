import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE = "sauti_desk_session";

function expectedToken(): string {
  const password = process.env.DASHBOARD_PASSWORD || "";
  const secret = process.env.DASHBOARD_SECRET || password || "dev-secret";
  return crypto.createHmac("sha256", secret).update(`ok:${password}`).digest("hex");
}

export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    // No password configured → open in local/dev only if explicitly allowed
    return process.env.DASHBOARD_OPEN === "true";
  }
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken()));
  } catch {
    return false;
  }
}

export function sessionCookieValue(): string {
  return expectedToken();
}

export { COOKIE as SESSION_COOKIE };

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ADMIN_LOGIN_PATH } from "@/lib/adminGate";
import { isAdminAuthenticated } from "@/lib/auth";

/**
 * Server gate for every Super Admin page and data loader.
 *
 * Call it first, outside any try/catch, before any await that reads data.
 * Next renders a layout and its page in parallel, so the layout check alone
 * does not stop the page from loading and streaming its data.
 *
 * connection() opts the request out of prerendering, so nothing is cached.
 * Signed out, or signed in only as a business owner, goes to the admin login.
 */
export async function requireSuperAdmin(): Promise<void> {
  await connection();
  if (!(await isAdminAuthenticated())) {
    redirect(ADMIN_LOGIN_PATH);
  }
}

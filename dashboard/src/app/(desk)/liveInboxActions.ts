"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";

/**
 * Drop cached Inbox, Home, and Contacts payloads so a Realtime event while
 * the owner is on another desk route still shows the new row when they return.
 */
export async function revalidateLiveDesk(): Promise<void> {
  if (!(await isAuthenticated())) return;
  revalidatePath("/home", "layout");
  revalidatePath("/calls", "layout");
  revalidatePath("/contacts", "layout");
}

/**
 * Drop Usage and Overview after a landed credit or a minute counter change.
 * Does not run when a payment is only started.
 */
export async function revalidateLiveUsage(): Promise<void> {
  if (!(await isAuthenticated())) return;
  revalidatePath("/wallet", "layout");
  revalidatePath("/home", "layout");
}

/**
 * Drop one open ticket so a new transcript line can render in place.
 */
export async function revalidateLiveTicket(callId: string): Promise<void> {
  if (!(await isAuthenticated())) return;
  const id = String(callId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  revalidatePath(`/calls/${id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";

/**
 * Drop cached Inbox, Home, and Contacts payloads so a Realtime event while
 * the owner is on another desk route still shows the new row when they return.
 */
export async function revalidateLiveDesk(): Promise<void> {
  if (!(await isAuthenticated())) return;
  revalidatePath("/home");
  revalidatePath("/calls", "layout");
  revalidatePath("/contacts", "layout");
}

"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";

/**
 * Drop cached Inbox and Home payloads so a Realtime event while the owner is
 * on Settings or a call still shows the new row when they return.
 */
export async function revalidateLiveDesk(): Promise<void> {
  if (!(await isAuthenticated())) return;
  revalidatePath("/home");
  revalidatePath("/calls", "layout");
}

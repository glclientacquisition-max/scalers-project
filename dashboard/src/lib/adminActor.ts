import { actorFromSession } from "@/lib/adminActorModel";
import { getAdminSession } from "@/lib/auth";

/** Signed-in Super Admin username for audit rows. Ignores anything the client sends. */
export async function adminActorName(): Promise<string> {
  return actorFromSession(await getAdminSession());
}

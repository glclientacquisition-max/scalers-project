import "server-only";

import { loadMembers, type MembersData } from "@/lib/membersLoad";
import { requireSuperAdmin } from "@/lib/adminGuard";

export type AdminShopPeople = MembersData & {
  ownerUserId: string | null;
};

/** Members and invites for one business on the Super Admin shop page. */
export async function loadAdminShopPeople(businessId: string): Promise<AdminShopPeople> {
  await requireSuperAdmin();
  const data = await loadMembers(businessId, { members: 25, invites: 10 });
  const owner = data.members.find((member) => member.role === "owner");
  return { ...data, ownerUserId: owner?.userId || null };
}

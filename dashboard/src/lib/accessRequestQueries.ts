import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AccessRequestListRow,
  isAccessRequestsSchemaV2Error,
} from "@/lib/accessRequestLogic";

const BASE_SELECT =
  "id, created_at, name, business, phone, email, about, status, decided_at, decided_by, invited_user_id";

const V2_SELECT =
  "note, note_updated_at, note_updated_by, decline_reason, decline_emailed_at, invite_resent_at, reopened_at";

export type AccessRequestFetchResult = {
  rows: AccessRequestListRow[];
  schemaV2: boolean;
};

export async function fetchAccessRequestList(
  admin: SupabaseClient
): Promise<AccessRequestFetchResult> {
  const fullSelect = `${BASE_SELECT}, ${V2_SELECT}`;
  const { data, error } = await admin
    .from("access_requests")
    .select(fullSelect)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!error) {
    return { rows: (data || []) as AccessRequestListRow[], schemaV2: true };
  }

  if (isAccessRequestsSchemaV2Error(error.message)) {
    const fallback = await admin
      .from("access_requests")
      .select(BASE_SELECT)
      .order("created_at", { ascending: false })
      .limit(500);
    if (fallback.error) throw fallback.error;
    return { rows: (fallback.data || []) as AccessRequestListRow[], schemaV2: false };
  }

  throw error;
}

export async function countPendingAccessRequests(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}

export type InviteJoinState = "invited" | "joined";

export async function loadInviteJoinStates(
  admin: SupabaseClient,
  invitedUserIds: string[]
): Promise<Record<string, InviteJoinState>> {
  const unique = [...new Set(invitedUserIds.filter(Boolean))];
  const out: Record<string, InviteJoinState> = {};
  await Promise.all(
    unique.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data?.user) {
        out[userId] = "invited";
        return;
      }
      const user = data.user;
      const joined = Boolean(user.last_sign_in_at || user.email_confirmed_at);
      out[userId] = joined ? "joined" : "invited";
    })
  );
  return out;
}

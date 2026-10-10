import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeRole, type Role } from "@/lib/permissions";
import { inviteState, seatSummary, type InviteRow, type SeatSummary } from "@/lib/invites";

export type MemberView = { userId: string; email: string; name: string; role: Role; joinedAt: string };
export type InviteView = { id: string; email: string; role: Role; state: string; expiresAt: string };
export type MembersData = { members: MemberView[]; invites: InviteView[]; seats: SeatSummary };

/** Service-role read (auth.users emails are not exposed over PostgREST). Caller must authorize. */
export async function loadMembers(tenantId: string): Promise<MembersData> {
  const admin = getSupabaseAdmin();
  const [mRes, iRes, tRes] = await Promise.all([
    admin.from("tenant_members").select("user_id, role, created_at").eq("tenant_id", tenantId).order("created_at"),
    admin
      .from("tenant_invites")
      .select("id, email, role, status, expires_at, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    admin.from("tenants").select("seat_included").eq("id", tenantId).maybeSingle(),
  ]);
  const rows = (mRes.data || []) as Array<{ user_id: string; role: string; created_at: string }>;
  const members: MemberView[] = await Promise.all(
    rows.map(async (row) => {
      const { data } = await admin.auth.admin.getUserById(row.user_id);
      const u = data?.user;
      const meta = (u?.user_metadata || {}) as Record<string, unknown>;
      return {
        userId: row.user_id,
        email: u?.email || "",
        name: String(meta.full_name || meta.name || "").trim(),
        role: normalizeRole(row.role),
        joinedAt: row.created_at,
      };
    })
  );
  const inviteRows = (iRes.data || []) as InviteRow[];
  const invites = inviteRows
    .map((r) => ({ id: r.id, email: r.email, role: normalizeRole(r.role), state: inviteState(r), expiresAt: r.expires_at }))
    .filter((r) => r.state === "pending");
  const included = Number((tRes.data as { seat_included?: number } | null)?.seat_included ?? 0);
  return { members, invites, seats: seatSummary({ members: members.length, invites: inviteRows, included }) };
}

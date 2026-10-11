import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeRole, type Role } from "@/lib/permissions";
import { seatSummary, type SeatSummary } from "@/lib/invites";
import { INVITES_PAGE, MEMBERS_PAGE, pageLimit } from "@/lib/teamLimits";

export type MemberView = { userId: string; email: string; name: string; role: Role; joinedAt: string };
export type InviteView = { id: string; email: string; role: Role; state: string; expiresAt: string };
export type MembersData = {
  members: MemberView[];
  invites: InviteView[];
  seats: SeatSummary;
  totals: { members: number; invites: number };
  limits: { members: number; invites: number };
};

type DirRow = { user_id: string; role: string; created_at: string; email: string | null; name: string | null; total: number };

/**
 * Service-role read, one query per list (members join auth.users in SQL, no per-member lookups).
 * Caller must authorize. Expired invites are filtered in SQL, so counts match the seat rule.
 */
export async function loadMembers(
  tenantId: string,
  opts: { members?: unknown; invites?: unknown } = {}
): Promise<MembersData> {
  const admin = getSupabaseAdmin();
  const memberLimit = pageLimit(opts.members, MEMBERS_PAGE);
  const inviteLimit = pageLimit(opts.invites, INVITES_PAGE);
  const nowIso = new Date().toISOString();
  const [mRes, iRes, tRes] = await Promise.all([
    admin.rpc("tenant_member_directory", { p_tenant: tenantId, p_limit: memberLimit, p_offset: 0 }),
    admin
      .from("tenant_invites")
      .select("id, email, role, expires_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(inviteLimit),
    admin.from("tenants").select("seat_included").eq("id", tenantId).maybeSingle(),
  ]);
  const rows = (mRes.data || []) as DirRow[];
  const members: MemberView[] = rows.map((row) => ({
    userId: row.user_id,
    email: row.email || "",
    name: String(row.name || "").trim(),
    role: normalizeRole(row.role),
    joinedAt: row.created_at,
  }));
  const memberTotal = Number(rows[0]?.total ?? 0);
  const inviteRows = (iRes.data || []) as Array<{ id: string; email: string; role: string; expires_at: string }>;
  const invites: InviteView[] = inviteRows.map((r) => ({
    id: r.id,
    email: r.email,
    role: normalizeRole(r.role),
    state: "pending",
    expiresAt: r.expires_at,
  }));
  const inviteTotal = Number(iRes.count ?? invites.length);
  const included = Number((tRes.data as { seat_included?: number } | null)?.seat_included ?? 0);
  const pendingStub = Array.from({ length: inviteTotal }, () => ({ status: "pending", expires_at: "9999-12-31T00:00:00Z" }));
  return {
    members,
    invites,
    seats: seatSummary({ members: memberTotal, invites: pendingStub, included }),
    totals: { members: memberTotal, invites: inviteTotal },
    limits: { members: memberLimit, invites: inviteLimit },
  };
}


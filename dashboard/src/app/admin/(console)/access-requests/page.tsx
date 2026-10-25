import { redirect } from "next/navigation";
import { AdminSetupError } from "@/components/AdminSetupError";
import { requireSuperAdmin } from "@/lib/adminGuard";
import {
  AdminAccessRequestsPanel,
  type AccessRequestPanelRow,
} from "@/components/AdminAccessRequestsPanel";
import { isAdminV2Enabled } from "@/lib/adminV2";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logAdminError } from "@/lib/adminErrors";
import {
  buildAccessRequestRepeatCounts,
  countAccessRequestsByStatus,
  filterAccessRequestsByStatus,
  matchesAccessRequestSearch,
  parseAccessRequestStatusFilter,
  type AccessRequestStatusFilter,
} from "@/lib/accessRequestLogic";
import { fetchAccessRequestList, loadInviteJoinStates } from "@/lib/accessRequestQueries";

export const instant = false;

export default async function AdminAccessRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) {
    redirect("/admin");
  }

  const params = await searchParams;
  const statusFilter: AccessRequestStatusFilter =
    params.status !== undefined && params.status !== ""
      ? parseAccessRequestStatusFilter(params.status)
      : "pending";
  const searchQuery = String(params.q || "").trim();

  let schemaV2 = false;
  let rows: AccessRequestPanelRow[] = [];
  let counts = { pending: 0, approved: 0, declined: 0 };

  try {
    const admin = getSupabaseAdmin();
    const fetched = await fetchAccessRequestList(admin);
    schemaV2 = fetched.schemaV2;
    const allRows = fetched.rows;
    counts = countAccessRequestsByStatus(allRows);
    const repeatCounts = buildAccessRequestRepeatCounts(allRows);

    let visible = filterAccessRequestsByStatus(allRows, statusFilter);
    if (searchQuery) {
      visible = visible.filter((row) => matchesAccessRequestSearch(row, searchQuery));
    }
    visible.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const inviteIds = visible
      .filter((r) => r.status === "approved" && r.invited_user_id)
      .map((r) => String(r.invited_user_id));

    const joinStates = await loadInviteJoinStates(admin, inviteIds);

    rows = visible.map((row) => ({
      ...row,
      repeatCount: repeatCounts[row.id] ?? 1,
      inviteState:
        row.status === "approved" && row.invited_user_id
          ? joinStates[String(row.invited_user_id)] ?? "invited"
          : null,
    }));
  } catch (err) {
    logAdminError("access-requests", err);
    return <AdminSetupError />;
  }

  return (
    <div>
      <h2 className="font-display text-2xl tracking-tight">Access requests</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Approve sends a Supabase invite. Owners set a password in onboarding.
      </p>
      <AdminAccessRequestsPanel
        rows={rows}
        counts={counts}
        statusFilter={statusFilter}
        searchQuery={searchQuery}
        schemaV2={schemaV2}
      />
    </div>
  );
}

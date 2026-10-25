import { redirect } from "next/navigation";
import { AdminSetupError } from "@/components/AdminSetupError";
import {
  AdminAccessRequestsPanel,
  type AccessRequestRow,
} from "@/components/AdminAccessRequestsPanel";
import { isAdminV2Enabled } from "@/lib/adminV2";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logAdminError } from "@/lib/adminErrors";

export const instant = false;

function sortRequests(rows: AccessRequestRow[]): AccessRequestRow[] {
  const order = { pending: 0, approved: 1, declined: 2 } as const;
  return [...rows].sort((a, b) => {
    const byStatus = order[a.status] - order[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export default async function AdminAccessRequestsPage() {
  if (!isAdminV2Enabled()) {
    redirect("/admin");
  }

  let rows: AccessRequestRow[] = [];
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("access_requests")
      .select(
        "id, created_at, name, business, phone, email, about, status, decided_at, decided_by"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    rows = sortRequests((data || []) as AccessRequestRow[]);
  } catch (err) {
    logAdminError("access-requests", err);
    return <AdminSetupError />;
  }

  return (
    <div>
      <h2 className="font-display text-2xl tracking-tight">Access requests</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Pending first. Approve sends a Supabase invite; the owner sets a password and lands in
        onboarding.
      </p>
      <AdminAccessRequestsPanel rows={rows} />
    </div>
  );
}

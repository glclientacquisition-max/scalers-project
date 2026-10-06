import { notFound } from "next/navigation";
import { AdminOverviewPanel } from "@/components/AdminOverviewPanel";
import { mergeQueueRows } from "@/lib/platformOpsModel";

/**
 * Super Admin Overview fixture. DASHBOARD_OPEN=true only.
 */
const WORK_QUEUE = mergeQueueRows({
  notices: [
    {
      kind: "pool_empty",
      detail: "1 business waiting. No numbers available.",
      status: "open",
    },
  ],
  businesses: [
    { id: "biz-waiting", name: "Waiting Co", status: "waiting" },
    { id: "biz-live", name: "Sample Shop", status: "active", packageName: null },
    { id: "biz-old", name: "Old Co", status: "archived" },
  ],
});

export default function DevAdminOverviewPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-desk space-y-16">
        <AdminOverviewPanel
          queue={WORK_QUEUE}
          needsNumber
          strip={{ tone: "attention", label: "Needs you" }}
          glance={{
            totalBusinesses: 3,
            activeBusinesses: 1,
            waitingForNumber: 1,
            withoutPackage: 2,
            availableDids: 0,
            assignedDids: 1,
            callsLast7Days: 12,
          }}
        />
        <AdminOverviewPanel
          queue={[]}
          needsNumber={false}
          strip={{ tone: "ok", label: "OK" }}
          glance={{
            totalBusinesses: 2,
            activeBusinesses: 2,
            waitingForNumber: 0,
            withoutPackage: 0,
            availableDids: 4,
            assignedDids: 2,
            callsLast7Days: 0,
          }}
        />
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import { AdminTodayPanel } from "@/components/AdminTodayPanel";
import { statusSentence, todayNumberRows } from "@/lib/adminTodayModel";
import { BusyToday, NOW } from "./fixture";

/**
 * Super Admin Today fixture. DASHBOARD_OPEN=true only. Busy state, then the quiet state with gaps.
 */
export default function DevAdminTodayPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-desk space-y-16">
        <BusyToday />
        <AdminTodayPanel
          dayLabel="Friday 9 Oct"
          status={statusSentence([])}
          queue={[]}
          needsNumber={false}
          numbers={todayNumberRows({ total: { today: 0, lastWeek: 0 }, needsHuman: null, abandoned: null }, NOW)}
        />
      </div>
    </main>
  );
}

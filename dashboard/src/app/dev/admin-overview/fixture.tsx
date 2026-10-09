import { AdminTodayPanel } from "@/components/AdminTodayPanel";
import { statusSentence, todayNumberRows, todayQueue } from "@/lib/adminTodayModel";
import { mergeQueueRows } from "@/lib/platformOpsModel";

/** Shared Super Admin Today fixture for the dev pages. Fixed clock so the copy is stable. */
export const NOW = new Date("2026-10-09T10:30:00.000Z");

const NOTICE_ROWS = mergeQueueRows({
  notices: [{ kind: "pool_empty", detail: "1 business waiting. No numbers available.", status: "open" }],
  businesses: [],
});

const QUEUE = todayQueue({
  noticeRows: NOTICE_ROWS,
  businesses: [
    { id: "biz-stuck", name: "Waiting Co", status: "waiting", createdAt: "2026-10-02T08:00:00.000Z", packageName: null },
    { id: "biz-new", name: "Fresh Bakery", status: "waiting", createdAt: "2026-10-08T08:00:00.000Z", packageName: null },
    { id: "biz-live", name: "Sample Shop", status: "active", createdAt: "2026-09-01T08:00:00.000Z", packageName: null },
    { id: "biz-quiet", name: "Quiet Salon", status: "active", createdAt: "2026-08-01T08:00:00.000Z", packageName: "Starter" },
    { id: "biz-busy", name: "Busy Clinic", status: "active", createdAt: "2026-08-01T08:00:00.000Z", packageName: "Growth" },
    { id: "biz-old", name: "Old Co", status: "archived", createdAt: "2026-07-01T08:00:00.000Z", packageName: null },
  ],
  callingBusinessIds: new Set(["biz-busy"]),
  now: NOW,
});

export function BusyToday() {
  return (
    <AdminTodayPanel
      dayLabel="Friday 9 Oct"
      status={statusSentence([{ active: true, critical: false, title: "Numbers" }])}
      queue={QUEUE}
      needsNumber
      numbers={todayNumberRows(
        {
          total: { today: 14, lastWeek: 11 },
          needsHuman: { today: 3, lastWeek: 4 },
          abandoned: { today: 2, lastWeek: 2 },
        },
        NOW,
      )}
    />
  );
}

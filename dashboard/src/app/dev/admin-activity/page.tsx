import { notFound } from "next/navigation";
import { AdminActivityPanel } from "@/components/AdminActivityPanel";
import { AdminShell } from "@/components/AdminNav";
import { activityItem, type ActivityRow } from "@/lib/adminActivityModel";

const ARIS = "11111111-1111-4111-8111-111111111111";
const DONE = "22222222-2222-4222-8222-222222222222";
const names = new Map([
  [ARIS, "Aris Hardware"],
  [DONE, "Done and Dusted"],
]);

const ROWS: ActivityRow[] = [
  {
    id: "1",
    created_at: "2026-10-09T10:41:00Z",
    actor: "alvin",
    action: "archive_business",
    tenant_id: DONE,
    amount_kes: null,
    detail: { reason: "Test business, finished with it", before: { active: true }, after: { active: false } },
  },
  {
    id: "2",
    created_at: "2026-10-09T09:12:00Z",
    actor: "alvin",
    action: "assign_package",
    tenant_id: ARIS,
    amount_kes: null,
    detail: { before: { package: "None" }, after: { package: "Starter 300" } },
  },
  {
    id: "3",
    created_at: "2026-10-09T08:03:00Z",
    actor: "wanjiru",
    action: "grant_package_minutes",
    tenant_id: ARIS,
    amount_kes: 1500,
    detail: { note: "Goodwill after outage" },
  },
  {
    id: "4",
    created_at: "2026-10-08T15:20:00Z",
    actor: "alvin",
    action: "assign_number",
    tenant_id: DONE,
    amount_kes: null,
    detail: { before: { number: null }, after: { number: "+254709221537" } },
  },
  {
    id: "5",
    created_at: "2026-10-08T07:55:00Z",
    actor: "shared-login",
    action: "save_alert_settings",
    tenant_id: null,
    amount_kes: null,
    detail: { before: { low_money_kes: 500 }, after: { low_money_kes: 1000 } },
  },
];

/** Activity fixture inside the admin shell. DASHBOARD_OPEN=true only. */
export default function DevAdminActivityPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return (
    <AdminShell operatorName="alvin">
      <AdminActivityPanel
        items={ROWS.map((row) => activityItem(row, names))}
        businesses={[...names].map(([id, name]) => ({ id, name }))}
        actors={["alvin", "shared-login", "wanjiru"]}
        business={null}
        actor={null}
        limit={100}
      />
    </AdminShell>
  );
}

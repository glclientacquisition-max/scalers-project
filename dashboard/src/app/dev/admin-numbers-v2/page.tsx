import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminNumbersV2 } from "@/components/admin/v2/AdminNumbersV2";
import { StepUpHost } from "@/components/ops/StepUpHost";
import { ADMIN_NUMBERS, ADMIN_NUMBERS_MOVE_TARGETS, ADMIN_NUMBERS_NOW, ADMIN_NUMBERS_PLAIN_HOLD, ADMIN_NUMBERS_PROTECTED, ADMIN_NUMBERS_WAITING } from "../fixtures/adminNumbers";

export const instant = false;

/** Numbers table + pane fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminNumbersV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminNumbersV2
        rows={[ADMIN_NUMBERS_PROTECTED, ADMIN_NUMBERS_PLAIN_HOLD, ...ADMIN_NUMBERS]}
        waiting={ADMIN_NUMBERS_WAITING}
        moveTargets={ADMIN_NUMBERS_MOVE_TARGETS}
        nowIso={ADMIN_NUMBERS_NOW}
        holdPolicy={{ columnsPresent: true, enabled: true, defaultDays: 14, reactivationFeeKes: null }}
      />
      <StepUpHost />
    </AdminShell>
  );
}

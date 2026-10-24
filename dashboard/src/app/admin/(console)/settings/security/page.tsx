import { notFound } from "next/navigation";
import { AdminSecurityV2 } from "@/components/admin/v2/AdminSecurityV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { parseAdminOperators } from "@/lib/adminOperators";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import { backupCodesLeft, factorStatuses } from "@/lib/ops/stepUpStore";

export const instant = false;

/** Settings › Security: your authenticator, backup codes, and operator reset. Never shows secrets. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") notFound();
  const gate = await requireAdminOperatorWrite();
  const me = gate.ok ? gate.operator : null;
  const mode = stepUpMode();
  const setup = (await searchParams).setup === "1";
  if (mode !== "enforce" || !me) {
    return <AdminSecurityV2 mode={mode} me={me} operators={[]} codesLeft={0} openSetup={false} />;
  }
  try {
    const names = parseAdminOperators().map((o) => o.username);
    const statuses = await factorStatuses(names);
    const codesLeft = await backupCodesLeft(me);
    return (
      <AdminSecurityV2
        mode={mode}
        me={me}
        operators={names.map((n) => ({ name: n, ...statuses[n] }))}
        codesLeft={codesLeft}
        openSetup={setup}
      />
    );
  } catch (err) {
    logAdminError("settings-security", err);
    return <DeskLoadError>Could not load security settings.</DeskLoadError>;
  }
}

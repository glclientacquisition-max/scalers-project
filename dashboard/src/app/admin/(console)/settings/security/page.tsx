import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdminSecurityV2 } from "@/components/admin/v2/AdminSecurityV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { parseAdminOperators } from "@/lib/adminOperators";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import {
  ALWAYS_UNLOCK, deviceTokenExpiry, grantValid, riskyKeysByArea, UNLOCK_AREAS, maskEmail, riskyActionKeys, SIGNIN_COOKIE, signInEmailFor, signInEmailSource,
  UNLOCK_COOKIE, verifyDeviceToken,
} from "@/lib/ops/stepUpCore";
import { backupCodesLeft, factorStatuses, loadAreaRows, loadFactor, loadGrant, loadUnlockSetting, recentSecurityEvents, stepUpKey } from "@/lib/ops/stepUpStore";
import { STEP_UP_WHAT, UNLOCK_AREA_WORDS } from "@/lib/ops/stepUpWords";

export const instant = false;

/** Settings › Security: your sign-in, backup codes, Unlock, operators, recent activity. Never shows secrets. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") notFound();
  const gate = await requireAdminOperatorWrite();
  const me = gate.ok ? gate.operator : null;
  const mode = stepUpMode();
  const setup = (await searchParams).setup === "1";
  if (mode !== "enforce" || !me) return <AdminSecurityV2 mode={mode} data={null} openSetup={false} />;
  try {
    const now = Date.now();
    const jar = await cookies();
    const names = parseAdminOperators().map((o) => o.username);
    const [statuses, codesLeft, factor, grant, events, areaRows, unlockSetting] = await Promise.all([
      factorStatuses(names), backupCodesLeft(me), loadFactor(me), loadGrant(jar.get(UNLOCK_COOKIE)?.value), recentSecurityEvents(20),
      loadAreaRows().catch((err) => { logAdminError("settings-security-areas", err); return null; }),
      loadUnlockSetting(),
    ]);
    const byArea = riskyKeysByArea();
    const areas = areaRows === null ? null : UNLOCK_AREAS.map((a) => {
      const row = areaRows.find((r) => r.area === a);
      const keys = byArea[a];
      return {
        id: a,
        title: UNLOCK_AREA_WORDS[a].title,
        covers: UNLOCK_AREA_WORDS[a].covers,
        required: row ? row.required !== false : true,
        updatedBy: row?.updated_by ?? null,
        updatedAt: row?.updated_at ?? null,
        switchable: [...new Set(keys.filter((k) => !ALWAYS_UNLOCK[k]).map((k) => STEP_UP_WHAT[k] || k))],
        always: keys.filter((k) => ALWAYS_UNLOCK[k]).map((k) => ({ what: STEP_UP_WHAT[k] || k, why: ALWAYS_UNLOCK[k] })),
      };
    });
    const deviceTok = jar.get(SIGNIN_COOKIE)?.value;
    const deviceOk = verifyDeviceToken(deviceTok, me, now, stepUpKey());
    const email = signInEmailFor(me);
    const protects = [...new Set(riskyActionKeys().map((k) => STEP_UP_WHAT[k]).filter(Boolean))];
    return (
      <AdminSecurityV2
        mode={mode}
        openSetup={setup}
        data={{
          me,
          enrolledAt: factor?.enrolled_at && factor.secret_enc ? factor.enrolled_at : null,
          needsReenrol: !!factor?.needs_reenrol,
          codesLeft,
          emailHint: email ? maskEmail(email) : null,
          emailSource: signInEmailSource(me),
          deviceUntil: deviceOk ? new Date(deviceTokenExpiry(deviceTok)!).toISOString() : null,
          unlockedUntil: grantValid(grant, me, now) ? new Date(grant!.expiresAt).toISOString() : null,
          protects,
          operators: names.map((n) => ({ name: n, ...statuses[n] })),
          events,
          areas,
          unlockMinutes: unlockSetting.minutes,
          unlockMinutesBy: unlockSetting.updatedBy,
          unlockMinutesAt: unlockSetting.updatedAt,
        }}
      />
    );
  } catch (err) {
    logAdminError("settings-security", err);
    return <DeskLoadError>Could not load security settings.</DeskLoadError>;
  }
}

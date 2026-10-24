import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminSecurityV2 } from "@/components/admin/v2/AdminSecurityV2";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";
import { ALWAYS_UNLOCK, riskyActionKeys, riskyKeysByArea, UNLOCK_AREAS } from "@/lib/ops/stepUpCore";
import { STEP_UP_WHAT, UNLOCK_AREA_WORDS } from "@/lib/ops/stepUpWords";

export const instant = false;

/** Settings › Security fixture, areas built from the real registry (Voices switched off). DASHBOARD_OPEN=true only. */
export default async function DevAdminSecurityV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const byArea = riskyKeysByArea();
  const now = Date.now();
  const areas = UNLOCK_AREAS.map((a) => ({
    id: a,
    title: UNLOCK_AREA_WORDS[a].title,
    covers: UNLOCK_AREA_WORDS[a].covers,
    required: a !== "voices",
    updatedBy: a === "voices" ? "alvin" : null,
    updatedAt: a === "voices" ? new Date(now - 3600_000).toISOString() : null,
    switchable: [...new Set(byArea[a].filter((k) => !ALWAYS_UNLOCK[k]).map((k) => STEP_UP_WHAT[k] || k))],
    always: byArea[a].filter((k) => ALWAYS_UNLOCK[k]).map((k) => ({ what: STEP_UP_WHAT[k] || k, why: ALWAYS_UNLOCK[k] })),
  }));
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      <AdminSecurityV2
        mode="enforce"
        openSetup={false}
        data={{
          me: "alvin", enrolledAt: new Date(now - 86400_000).toISOString(), needsReenrol: false, codesLeft: 10,
          emailHint: "sc***@gmail.com", emailSource: "alert", deviceUntil: new Date(now + 6 * 3600_000).toISOString(),
          unlockedUntil: new Date(now + 8 * 60_000).toISOString(),
          protects: [...new Set(riskyActionKeys().map((k) => STEP_UP_WHAT[k]).filter(Boolean))],
          operators: [{ name: "alvin", enrolled: true, needsReenrol: false, lockedUntil: null }],
          events: [{ id: "1", created_at: new Date(now - 3600_000).toISOString(), actor: "alvin", action: "admin.step_up.area_changed" }],
          areas,
        }}
      />
    </AdminShell>
  );
}

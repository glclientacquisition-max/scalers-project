import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskRoleProvider, ViewOnlyBanner } from "@/components/DeskRole";
import { SettingsRail } from "@/components/SettingsSideNav";
import { fixtureTakeMessages } from "./fixtures";
import type { TenantRow } from "@/lib/supabase";
import { cleaningTenant } from "../policies-remake/fixtures";
import { DevIdentity } from "./DevSafeMode";

/**
 * Slice D1: Settings > Identity "Take messages only" with fixture data. DASHBOARD_OPEN=true only.
 * ?state=off | on | support | env, ?role=viewer, ?fail=1 (the save fails, to see Try again).
 * Inbox indicator: /dev/inbox?messages=on|support. Catalogue mark: /dev/catalogue?complete=marked|unmarked.
 * Super Admin toggle: /dev/d1-safe-mode/admin?state=off|on|owner.
 */
export const instant = false;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const tenant = {
  ...cleaningTenant,
  agent_name: "Aisha",
  agent_tone: "warm",
  social_handles: { channels: [{ kind: "phone", label: "Main", value: "+254712345678" }] },
} as unknown as TenantRow;

export default async function DevSafeModePage({ searchParams }: Props) {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const p = (await searchParams) || {};
  const viewer = one(p.role) === "viewer";
  return (
    <DeskRoleProvider role={viewer ? "viewer" : null}>
      <div className={deskShellClass}>
        <DeskRail needsCount={0} homeHref="/dev/home" />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
          <ViewOnlyBanner />
          <main data-desk-main="" className={deskMainClass}>
            <div className="w-full min-w-0" data-settings-console="" data-desk-nested="">
              <DevIdentity
                tenant={tenant}
                takeMessages={fixtureTakeMessages(one(p.state))}
                fail={one(p.fail) === "1"}
                sidebar={<SettingsRail tab="train" trainPanel="identity" />}
              />
            </div>
          </main>
          <DeskTabBar needsCount={0} />
        </div>
      </div>
    </DeskRoleProvider>
  );
}

import { notFound } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskRoleProvider, ViewOnlyBanner } from "@/components/DeskRole";
import { SettingsRail } from "@/components/SettingsSideNav";
import type { PoliciesSheetState } from "@/components/policies/PoliciesSettings";
import type { PolicyTopic } from "@/lib/policyRules";
import type { PaymentMethod } from "@/lib/payments";
import { DevPolicies } from "./DevPolicies";
import { cleaningTenant, retailTenant } from "./fixtures";

/**
 * Settings › Policies (remake) with fixture data. DASHBOARD_OPEN=true only.
 * ?vertical=retail, ?role=viewer, ?fail=1 (saves fail),
 * ?sheet=pay-timing | add-method | holds | unsure | rule:<topic> | method:<method>
 */
export const instant = false;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function parseSheet(raw: string | undefined): PoliciesSheetState | null {
  if (!raw) return null;
  if (raw === "pay-timing" || raw === "add-method" || raw === "holds" || raw === "unsure") return { kind: raw };
  const [k, v] = raw.split(":");
  if (k === "rule" && v) return { kind: "rule", topic: v as PolicyTopic };
  if (k === "method" && v) return { kind: "method", method: v as PaymentMethod, isNew: false };
  return null;
}

export default async function DevPoliciesRemakePage({ searchParams }: Props) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const p = (await searchParams) || {};
  const retail = one(p.vertical) === "retail";
  const viewer = one(p.role) === "viewer";
  return (
    <DeskRoleProvider role={viewer ? "viewer" : null}>
      <div className={deskShellClass}>
        <DeskRail needsCount={0} homeHref="/dev/home" />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
          <ViewOnlyBanner />
          <main data-desk-main="" className={deskMainClass}>
            <div className="w-full min-w-0" data-settings-console="" data-desk-nested="">
              <DevPolicies
                tenant={retail ? retailTenant : cleaningTenant}
                fail={one(p.fail) === "1"}
                sheet={parseSheet(one(p.sheet))}
                sidebar={<SettingsRail tab="train" trainPanel="policies" />}
              />
            </div>
          </main>
          <DeskTabBar needsCount={0} />
        </div>
      </div>
    </DeskRoleProvider>
  );
}

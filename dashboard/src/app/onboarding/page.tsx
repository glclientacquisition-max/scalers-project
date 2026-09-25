import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { getAuthUser, isAuthenticated, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { OnboardingWizard } from "./OnboardingWizard";

// instant = false: owner cookie session must run before the wizard.
export const instant = false;

function OnboardingExit() {
  return (
    <form action="/api/logout" method="post">
      <button
        type="submit"
        className={[
          "min-h-11 rounded-md px-2 text-sm text-ink-soft hover:text-warn",
          deskShiftClass,
          focusRingVisible,
        ].join(" ")}
      >
        Sign out
      </button>
    </form>
  );
}

export default async function OnboardingPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  // Super Admin / legacy desk skips the owner wizard.
  if ((await isLegacyAuthenticated()) && !(await getAuthUser())) {
    redirect("/admin");
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="flex items-start justify-between gap-3">
            <BrandWordmark href="/onboarding" context="Workspace" variant="lockup" priority />
            <OnboardingExit />
          </div>
          <p className="mt-6 text-ink-soft leading-relaxed">
            No workspace linked to this account. Sign up again or contact support.
          </p>
        </div>
      </main>
    );
  }

  if (!tenantNeedsOnboarding(tenant)) {
    redirect("/home");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <BrandWordmark href="/onboarding" context="Setup" variant="lockup" priority />
          <OnboardingExit />
        </div>
        <h1 className="mt-8 font-display text-2xl text-ink">
          Set up {tenant.business_name}
        </h1>
        <OnboardingWizard />
      </div>
    </main>
  );
}

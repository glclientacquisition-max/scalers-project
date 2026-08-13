import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { getAuthUser, isAuthenticated, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";
import { OnboardingWizard } from "./OnboardingWizard";

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
      <main className="min-h-screen flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <BrandWordmark href="/onboarding" context="Workspace" variant="lockup" priority />
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
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <BrandWordmark href="/onboarding" context="Setup" variant="lockup" priority />
        <h1 className="mt-8 font-display text-2xl text-ink">
          Set up {tenant.business_name}
        </h1>
        <OnboardingWizard />
      </div>
    </main>
  );
}

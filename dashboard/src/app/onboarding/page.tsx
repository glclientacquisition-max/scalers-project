import { redirect } from "next/navigation";
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
    redirect("/calls");
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <p className="font-display text-4xl text-[var(--accent-deep)] tracking-tight">
            Sauti Desk
          </p>
          <p className="mt-4 text-[var(--ink-soft)] leading-relaxed">
            No workspace is linked to this account yet. Sign up again or contact support.
          </p>
        </div>
      </main>
    );
  }

  if (!tenantNeedsOnboarding(tenant)) {
    redirect("/calls");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <p className="font-display text-4xl sm:text-5xl text-[var(--accent-deep)] tracking-tight">
          Sauti Desk
        </p>
        <h1 className="mt-4 font-display text-2xl text-[var(--ink)]">
          Set up {tenant.business_name}
        </h1>
        <p className="mt-2 text-[var(--ink-soft)] leading-relaxed">
          Three quick steps and we write your AI receptionist&apos;s knowledge for live calls.
        </p>
        <OnboardingWizard businessName={tenant.business_name} />
      </div>
    </main>
  );
}

import { loadSetupContext } from "@/lib/setupServer";
import { SetupFlow } from "./SetupFlow";
import { ConfirmEmailScreen } from "./ConfirmEmailScreen";
import { redirect } from "next/navigation";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { ThemeDock } from "@/components/ThemePicker";
import { getAuthUser, isAuthenticated, isLegacyAuthenticated } from "@/lib/auth";
import { tenantNeedsOnboarding } from "@/lib/onboarding";
import { getCurrentTenant } from "@/lib/tenant";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { OnboardingWizard } from "./OnboardingWizard";
import { memberCan } from "@/lib/requireMember";
import { WorkspaceNotReady } from "@/components/WorkspaceNotReady";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

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

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }

  // Super Admin / legacy desk skips the owner wizard.
  if ((await isLegacyAuthenticated()) && !(await getAuthUser())) {
    redirect("/admin");
  }

  const ctx = await loadSetupContext();
  if (ctx.kind === "unconfirmed") return <ConfirmEmailScreen email={ctx.user.email || ""} />;
  const tenant = ctx.kind === "ready" ? ctx.row : ctx.kind === "legacy" ? await getCurrentTenant() : null;
  if (!tenant) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="flex items-start justify-between gap-3">
            <BrandWordmark href="/onboarding" context="Workspace" variant="lockup" priority />
            <div className="flex items-center gap-1">
              <ThemeDock />
              <OnboardingExit />
            </div>
          </div>
          <h1 className="mt-8 font-display text-2xl text-ink">Create your workspace</h1>
          <p className="mt-2 text-ink-soft leading-relaxed">
            This account isn&apos;t linked to a business yet. Add one to continue.
          </p>
          <CreateWorkspaceForm />
        </div>
      </main>
    );
  }

  if (ctx.kind === "ready") {
    if (ctx.row.setup_completed_at) redirect("/home");
    if (!(await memberCan("settings.edit"))) {
      return <WorkspaceNotReady businessName={ctx.row.business_name || null} />;
    }
    const { step } = await searchParams;
    return (
      <SetupFlow
        tenantId={ctx.row.id}
        businessName={ctx.row.business_name}
        initialDraft={ctx.draft}
        initialVersion={ctx.row.onboarding_draft_version}
        furthestStep={ctx.row.onboarding_step}
        requestedStep={step || null}
        signOut={<OnboardingExit />}
      />
    );
  }

  // Database without the setup migration: previous wizard, previous completion check.
  const legacyTenant = await getCurrentTenant();
  if (legacyTenant && tenantNeedsOnboarding(legacyTenant) && !(await memberCan("settings.edit"))) {
    return <WorkspaceNotReady businessName={legacyTenant.business_name || null} />;
  }
  if (!legacyTenant || !tenantNeedsOnboarding(legacyTenant)) {
    redirect("/home");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <BrandWordmark href="/onboarding" context="Setup" variant="lockup" priority />
          <div className="flex items-center gap-1">
            <ThemeDock />
            <OnboardingExit />
          </div>
        </div>
        <h1 className="mt-8 font-display text-2xl text-ink">
          Set up {legacyTenant.business_name}
        </h1>
        <OnboardingWizard />
      </div>
    </main>
  );
}

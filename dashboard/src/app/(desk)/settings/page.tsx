import { getCurrentTenant } from "@/lib/tenant";
import { TenantForm } from "@/components/TenantForm";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";

/** Allow URL fetch + Gemini extract/compile without premature platform cutoffs. */
export const maxDuration = 60;

const SECTIONS = [
  { id: "today", label: "Today" },
  { id: "import", label: "Import" },
  { id: "train", label: "Train" },
  { id: "test", label: "Test" },
] as const;

export default async function SettingsPage() {
  let tenant;
  try {
    tenant = await getCurrentTenant();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Could not load business: {message}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-4xl tracking-tight">Business</h1>
        <p className="mt-3 text-ink-soft">
          No workspace is linked to this account yet. Sign up again or apply{" "}
          <code className="text-sm">docs/supabase/multi_tenant_onboarding.sql</code> and
          contact support.
        </p>
      </div>
    );
  }

  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");

  return (
    <div className="max-w-3xl pb-24">
      <h1 className="font-display text-4xl tracking-tight">Business</h1>
      <p className="mt-1 text-sm text-ink-soft sm:text-base">
        Train your receptionist, post today&apos;s updates, and test the line.
      </p>

      <p className="mt-6 text-sm text-ink-soft">
        Your receptionist number{" "}
        <span className="font-medium text-ink">
          {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
        </span>
      </p>
      {pendingDid ? (
        <p className="mt-2 text-xs text-ink-soft">
          We&apos;re assigning your number. Keep training now; testing goes live as soon as
          the line is ready.
        </p>
      ) : null}

      <nav
        aria-label="Business sections"
        className="sticky top-16 z-20 -mx-1 mt-6 overflow-x-auto bg-surface-canvas/90 px-1 py-2 backdrop-blur-sm"
      >
        <ul className="flex min-w-max gap-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent-deep focus-visible:outline-none focus-visible:shadow-focus"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div id="today" className="mt-8 scroll-mt-28">
        <DailyBulletinPanel tenant={tenant} />
      </div>

      <div id="import" className="mt-10 scroll-mt-28 border-t border-line pt-10">
        <KnowledgeIngestPanel tenant={tenant} />
        <CatalogImportPanel tenant={tenant} />
        <p className="mt-4 text-xs text-ink-soft">
          Jump to{" "}
          <a
            href="#golden-faqs"
            className="font-medium text-accent-deep underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            Golden FAQs
          </a>{" "}
          to edit answers by hand.
        </p>
      </div>

      <div id="train" className="mt-10 scroll-mt-28 border-t border-line pt-10">
        <TenantForm
          key={[
            tenant.id,
            Array.isArray(tenant.services_catalog)
              ? tenant.services_catalog.length
              : 0,
            Array.isArray(tenant.product_catalog)
              ? tenant.product_catalog.length
              : 0,
            Array.isArray(tenant.faqs) ? tenant.faqs.length : 0,
            Array.isArray(tenant.team_directory) ? tenant.team_directory.length : 0,
            String(tenant.llm_system_prompt || "").length,
            tenant.vertical || "",
            JSON.stringify(tenant.social_handles || {}),
          ].join(":")}
          tenant={tenant}
        />
      </div>

      <section
        id="test"
        className="mt-10 scroll-mt-28 rounded-2xl border border-accent/30 bg-accent-soft p-6"
      >
        <h2 className="font-display text-2xl tracking-tight text-accent-deep">
          Test your receptionist
        </h2>
        {pendingDid ? (
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Number pending. Keep training above. You can place a test call as soon as your line is assigned.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-ink">
              Call{" "}
              <a
                href={`tel:${tenant.sautikit_virtual_number}`}
                className="font-display text-xl font-medium text-accent-deep underline decoration-accent/40 underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
              >
                {tenant.sautikit_virtual_number}
              </a>{" "}
              from a different phone to hear your new settings live.
            </p>
            <p className="mt-2 text-xs text-ink-soft">
              Changes apply to new calls right after training. Ask about your services and
              prices to check it answers correctly.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { TenantRow } from "@/lib/supabase";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { TenantForm, type SettingsPanel } from "@/components/TenantForm";

const TABS = [
  { id: "today", label: "Today" },
  { id: "catalog", label: "Catalog" },
  { id: "train", label: "Train" },
  { id: "import", label: "Import" },
  { id: "test", label: "Test" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TRAIN_PANELS: { id: SettingsPanel; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "hours", label: "Hours" },
  { id: "team", label: "Team" },
  { id: "faqs", label: "FAQs" },
  { id: "tools", label: "Tools" },
];

function parseTab(raw: string | null): TabId {
  if (raw === "catalog" || raw === "train" || raw === "import" || raw === "test") {
    return raw;
  }
  return "today";
}

function parseTrainPanel(raw: string | null): SettingsPanel {
  if (
    raw === "identity" ||
    raw === "hours" ||
    raw === "team" ||
    raw === "faqs" ||
    raw === "tools"
  ) {
    return raw;
  }
  return "identity";
}

/**
 * Business settings shell: one job per tab so owners are not scrolling a mega-form.
 * Catalog / Train keep TenantForm mounted for Save & train.
 */
export function BusinessSettingsShell({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const trainPanel = parseTrainPanel(searchParams.get("panel"));
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");

  const setQuery = useCallback(
    (next: { tab?: TabId; panel?: SettingsPanel }) => {
      const q = new URLSearchParams(searchParams.toString());
      const nextTab = next.tab ?? tab;
      q.set("tab", nextTab);
      if (nextTab === "train") {
        q.set("panel", next.panel ?? trainPanel);
      } else {
        q.delete("panel");
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, tab, trainPanel]
  );

  const formPanel: SettingsPanel = useMemo(() => {
    if (tab === "catalog") return "catalog";
    if (tab === "train") return trainPanel;
    return "identity";
  }, [tab, trainPanel]);

  const showForm = tab === "catalog" || tab === "train";

  return (
    <div className="max-w-3xl pb-28">
      <header className="space-y-2">
        <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
          Business
        </h1>
        <p className="text-sm text-ink-soft sm:text-base">
          Train your receptionist in short steps — not one endless page.
        </p>
        <p className="text-sm text-ink-soft">
          Line{" "}
          <span className="font-medium text-ink">
            {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
          </span>
        </p>
      </header>

      <nav
        aria-label="Business sections"
        className="sticky top-16 z-20 -mx-1 mt-6 border-b border-line bg-surface-canvas/95 px-1 backdrop-blur-sm"
      >
        <ul className="flex gap-1 overflow-x-auto py-2">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setQuery({ tab: item.id })}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "inline-flex rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                    active
                      ? "bg-accent-soft text-accent-deep"
                      : "text-ink-soft hover:bg-surface hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "today" ? (
        <div className="mt-8">
          <DailyBulletinPanel tenant={tenant} />
        </div>
      ) : null}

      {tab === "import" ? (
        <div className="mt-8 space-y-8">
          <KnowledgeIngestPanel tenant={tenant} />
          <CatalogImportPanel tenant={tenant} />
          <p className="text-xs text-ink-soft">
            After importing, open{" "}
            <button
              type="button"
              onClick={() => setQuery({ tab: "catalog" })}
              className="font-medium text-accent-deep underline"
            >
              Catalog
            </button>{" "}
            to review, then{" "}
            <button
              type="button"
              onClick={() => setQuery({ tab: "train", panel: "faqs" })}
              className="font-medium text-accent-deep underline"
            >
              FAQs
            </button>{" "}
            if you need hand-written answers.
          </p>
        </div>
      ) : null}

      {tab === "test" ? (
        <section className="mt-8 rounded-2xl border border-accent/30 bg-accent-soft p-6">
          <h2 className="font-display text-2xl tracking-tight text-accent-deep">
            Test your receptionist
          </h2>
          {pendingDid ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Number pending. Train first, then test as soon as the line is assigned.
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
                from a different phone to hear your settings live.
              </p>
              <p className="mt-2 text-xs text-ink-soft">
                Ask about services and prices to check answers stay accurate.
              </p>
            </>
          )}
        </section>
      ) : null}

      <div className={showForm ? "mt-6" : "hidden"} aria-hidden={!showForm}>
        {tab === "train" ? (
          <nav aria-label="Train sections" className="mb-6">
            <ul className="flex flex-wrap gap-2">
              {TRAIN_PANELS.map((item) => {
                const active = trainPanel === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setQuery({ tab: "train", panel: item.id })}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                        active
                          ? "border-accent bg-accent-soft text-accent-deep"
                          : "border-line text-ink-soft hover:border-accent/50 hover:text-ink",
                      ].join(" ")}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        {tab === "catalog" ? (
          <div className="mb-6">
            <h2 className="font-display text-2xl tracking-tight text-ink">Catalog</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Services and products the receptionist can talk about. Long lists are paged.
            </p>
          </div>
        ) : null}

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
          panel={formPanel}
        />
      </div>
    </div>
  );
}

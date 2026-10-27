"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import {
  ArrowDownTrayIcon,
  BellIcon,
  BuildingStorefrontIcon,
  ClockIcon,
  CreditCardIcon,
  MapIcon,
  DocumentTextIcon,
  LanguageIcon,
  MapPinIcon,
  MicrophoneIcon,
  PhoneArrowUpRightIcon,
  PhoneIcon,
  QuestionMarkCircleIcon,
  ReceiptPercentIcon,
  ShoppingBagIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { useCan } from "@/components/DeskRole";
import {
  settingsRailClass,
  settingsRailWrapClass,
} from "@/components/settingsUi";
import { deskShiftClass } from "@/components/ui/deskChrome";
import {
  SETTINGS_NAV,
  settingsNavHref,
  settingsNavItemActive,
  type BusinessSettingsTab,
  type SettingsNavSection,
  type SettingsPanel,
} from "@/lib/businessSettingsNav";
import {
  settingsStatusKey,
  type SettingsListStatus,
} from "@/lib/settingsOptionStatus";

function SettingsChevron({ active }: { active: boolean }) {
  return (
    <ChevronRightIcon
      aria-hidden
      className={active ? "size-5 shrink-0 text-ink" : "size-5 shrink-0 text-ink-3"}
    />
  );
}

const settingsMenuRowClass =
  "flex min-h-11 w-full items-center gap-3 px-3 text-body font-medium text-ink";

/** One icon per section, keyed like the status map. */
const SETTINGS_ICON: Record<string, typeof ClockIcon> = {
  "train:identity": BuildingStorefrontIcon,
  "train:hours": ClockIcon,
  "train:locations": MapPinIcon,
  "train:policies": DocumentTextIcon,
  catalog: ShoppingBagIcon,
  import: ArrowDownTrayIcon,
  "train:faqs": QuestionMarkCircleIcon,
  "train:tools": MicrophoneIcon,
  "train:pronunciation": LanguageIcon,
  test: PhoneArrowUpRightIcon,
  calls: PhoneIcon,
  "train:team": UsersIcon,
  alerts: BellIcon,
  "assistant-say": DocumentTextIcon,
  "/settings/areas": MapIcon,
  "/settings/plan": CreditCardIcon,
  "/settings/billing": ReceiptPercentIcon,
};

/** Statuses that ask the owner to act get the attention colour; the rest stay quiet. */
const needsAction = (text: string) => /^(needs|not )/i.test(text);

function visibleSections(manageBilling: boolean, assistantSayPage: boolean): SettingsNavSection[] {
  return SETTINGS_NAV.flatMap((section) => {
    const items = section.items.filter((item) => {
      if ("tab" in item.target && item.target.tab === "assistant-say" && !assistantSayPage) return false;
      if (!("href" in item.target)) return true;
      if (item.target.href === "/settings/areas") return true;
      return manageBilling;
    });
    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

/**
 * Settings home (phone screen and the md+ right pane) and the md+ rail share this list.
 * Home rows: icon, name, one plain line, status. Rail rows: name and status only.
 * Plan and Billing stay in the list for the owner and an admin.
 */
export function SettingsMenu({
  tab,
  trainPanel,
  variant,
  optionStatus,
  activePath,
  assistantSayPage = false,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  assistantSayPage?: boolean;
  variant: "index" | "rail";
  optionStatus: Record<string, SettingsListStatus>;
  /** Live pages use the real pathname. The billing fixture passes the settings path it is standing in for. */
  activePath?: string;
}) {
  const pathname = usePathname();
  const path = activePath ?? pathname;
  const manageBilling = useCan("billing.manage");
  const sections = visibleSections(manageBilling, assistantSayPage);
  const isRail = variant === "rail";
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !isRail) return;
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) return;
    const target = current.closest("section") ?? current;
    const navRect = nav.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.bottom > navRect.bottom - 8) {
      nav.scrollTop += targetRect.bottom - navRect.bottom + 12;
    } else if (targetRect.top < navRect.top + 8) {
      nav.scrollTop -= navRect.top - targetRect.top + 12;
    }
  }, [isRail, path]);
  return (
    <nav
      ref={navRef}
      aria-label="Settings sections"
      data-settings-menu={variant}
      className={isRail ? settingsRailClass : "grid min-w-0 w-full gap-6 xl:grid-cols-2 xl:items-start xl:gap-x-8"}
    >
      {isRail ? (
        <Link
          href="/settings"
          className="mb-4 flex min-h-11 items-center rounded-lg px-1 text-title text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Settings
        </Link>
      ) : null}
      {sections.map((section, index) => (
        <section key={section.id} className={isRail && index > 0 ? "mt-6" : undefined}>
          <h2 className="pointer-events-none mb-2 select-none px-1 text-meta font-medium text-ink-2">
            {section.title}
          </h2>
          <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface [&>li:first-child>a]:rounded-t-2xl [&>li:last-child>a]:rounded-b-2xl">
            {section.items.map((item) => {
              const active = settingsNavItemActive(item.target, tab, trainPanel, path);
              const key = settingsStatusKey(item.target);
              const status = optionStatus[key];
              const statusText = status?.text || "";
              return (
                <li key={key} className="border-b border-hairline last:border-b-0">
                  <Link
                    href={settingsNavHref(item.target)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      settingsMenuRowClass,
                      isRail ? "" : "min-h-16",
                      deskShiftClass,
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                      active ? "bg-accent-tonal" : "hover:bg-surface-2 active:bg-surface-2",
                    ].join(" ")}
                  >
                    {isRail ? (
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    ) : (
                      <>
                        <SettingsRowIcon statusKey={key} />
                        <span className="min-w-0 flex-1 py-2">
                          <span className="block truncate">{item.label}</span>
                          <span className="block text-meta font-normal text-ink-2">{item.description}</span>
                        </span>
                      </>
                    )}
                    {statusText ? (
                      <span
                        title={status?.title || statusText}
                        className={`max-w-[40%] shrink-0 truncate text-meta font-normal tabular-nums ${needsAction(statusText) ? "text-attention" : "text-ink-2"}`}
                      >
                        {statusText}
                      </span>
                    ) : null}
                    <SettingsChevron active={active} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function SettingsRowIcon({ statusKey }: { statusKey: string }) {
  const Icon = SETTINGS_ICON[statusKey] ?? DocumentTextIcon;
  return (
    <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-tonal text-accent">
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** md+ settings rail. Hidden on the phone, where the page leads with Back. */
export function SettingsRail({
  tab = "menu",
  trainPanel = "identity",
  optionStatus = {},
  activePath,
  assistantSayPage = false,
}: {
  tab?: BusinessSettingsTab;
  trainPanel?: SettingsPanel;
  optionStatus?: Record<string, SettingsListStatus>;
  activePath?: string;
  assistantSayPage?: boolean;
}) {
  return (
    <div className={settingsRailWrapClass}>
      <SettingsMenu
        tab={tab}
        trainPanel={trainPanel}
        variant="rail"
        optionStatus={optionStatus}
        activePath={activePath}
        assistantSayPage={assistantSayPage}
      />
    </div>
  );
}

"use client";

import { BillingNote } from "@/components/DeskBillingBanner";
import { MembersPanel } from "@/components/MembersPanel";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { OwnerInvoiceList } from "@/components/plan/OwnerInvoiceList";
import { PlanPicker } from "@/components/plan/PlanPicker";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { UsageSummary } from "@/components/plan/UsageSummary";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import { PageHeader } from "@/components/ui/PageHeader";
import { ownerBillingSurface } from "@/lib/betaBilling";
import { pickBillingBanner } from "@/lib/billingBanner";
import { ownerBillingView } from "@/lib/billingStateModel";
import { seatSummary } from "@/lib/invites";
import { invoicePayState } from "@/lib/invoicePayState";
import type { MembersData } from "@/lib/membersLoad";
import type { OwnerInvoiceRow, OwnerPlanModel, PlanCycle, PlanSku, PublishedPlan } from "@/lib/ownerPlanLoad";
import { annualPriceKes, annualSavingKes, formatKsh } from "@/lib/planPricing";
import { trialRemaining } from "@/lib/trialRemaining";

const PREVIEW_NOW = new Date("2026-10-18T09:00:00+03:00");

function sample(
  sku: PlanSku,
  name: string,
  monthly: number,
  discount: number,
  minutes: number,
  seats: number,
  credits: number,
): PublishedPlan {
  return {
    sku,
    name,
    monthlyKes: monthly,
    annualKes: annualPriceKes(monthly, discount),
    savingKes: annualSavingKes(monthly, discount),
    minutes,
    seats,
    dids: 1,
    messageCredits: credits,
    inboundPerMinuteKes: 26,
    outboundPerMinuteKes: 34,
  };
}

const plans = [
  sample("starter", "Starter", 7000, 17, 300, 3, 1000),
  sample("growth", "Growth", 18000, 10, 800, 8, 2500),
  sample("scale", "Scale", 35000, 10, 1600, 20, 5500),
];

function growthModel(cycle: PlanCycle, trialText: string | null = null): OwnerPlanModel {
  return {
    freeBeta: false,
    billingStatus: trialText ? "trialing" : "active",
    surface: ownerBillingSurface(trialText ? "trialing" : "active"),
    currentSku: "growth",
    currentMonthlyKes: 18000,
    cycle,
    plans,
    seatsUsed: 3,
    seatsIncluded: 8,
    trialText,
    onDemandLocked: Boolean(trialText),
    invoices: [],
    notices: [],
    periodEndLabel: "31 Oct",
    dayOfPeriod: 10,
    daysInPeriod: 30,
    banner: null,
  };
}

function invoiceItems(invoices: OwnerInvoiceRow[]) {
  return invoices.flatMap((invoice) => {
    const pay = invoicePayState({ status: invoice.status, payToken: invoice.payToken });
    if (pay.hidden) return [];
    const statusLabel =
      pay.label === "Paid" || pay.label === "Checking payment"
        ? pay.label
        : invoice.dueAt
          ? `Due by ${invoice.dueAt}`
          : "Open";
    return [
      {
        id: invoice.id,
        number: invoice.number,
        totalLabel: formatKsh(invoice.totalKes),
        statusLabel,
        payHref: pay.showPayButton ? pay.payHref : null,
        payLabel: pay.showPayButton ? `Pay ${formatKsh(invoice.totalKes)}` : null,
      },
    ];
  });
}

const sampleInvoices: OwnerInvoiceRow[] = [
  {
    id: "inv-1042",
    number: "INV-1042",
    status: "open",
    totalKes: 8120,
    dueAt: "9 Oct",
    periodStart: "1 Oct",
    periodEnd: "31 Oct",
    payToken: null,
  },
  {
    id: "inv-1038",
    number: "INV-1038",
    status: "paid",
    totalKes: 8120,
    dueAt: "9 Sep",
    periodStart: "1 Sep",
    periodEnd: "30 Sep",
    payToken: null,
  },
];

function UsagePreview({ kind }: { kind: "beta" | "paid" }) {
  const beta = kind === "beta";
  const view = ownerBillingView({
    state: {
      package_state: "active",
      package_name: "Growth",
      included_minutes: 800,
      used_minutes: beta ? 120 : 260,
      sms_included: 2500,
      sms_used: beta ? 40 : 420,
      on_demand_enabled: !beta,
      mode_label: beta ? "beta" : "metered",
      period_end: "2026-11-01T00:00:00+03:00",
    },
    monthlyPriceKes: beta ? null : 18000,
    smsMessages: null,
    seatsIncluded: 8,
    seatsUsed: 3,
  });
  const messageCredits = 2500;
  const creditsUsed = beta ? 40 : 420;
  const rows = view.rows
    .filter((row) => row.key !== "email" && row.key !== "whatsapp" && row.key !== "minutes")
    .map((row) =>
      row.key === "sms"
        ? {
            key: row.key,
            label: "Message credits",
            included: messageCredits,
            used: creditsUsed,
            left: messageCredits - creditsUsed,
          }
        : {
            key: row.key,
            label: row.label,
            included: row.included,
            used: row.used,
            left: row.left,
          },
    );

  return (
    <div>
      <UsageSummary
        minutesLeft={view.minutesLeft}
        minutesIncluded={view.minutesIncluded}
        minutesUsed={beta ? 120 : 260}
        periodEndLabel={view.periodEndLabel}
        beta={beta}
        planLine={beta ? null : "Growth · KSh 18,000 a month"}
        rows={rows}
        showChangePlan
      />
      {beta ? null : (
        <div className="max-w-2xl">
          <OnDemandUsagePanel tenantId="preview" enabled extraMinuteKes={26} />
        </div>
      )}
      <section className="mt-6 max-w-2xl overflow-hidden rounded-2xl border border-hairline bg-surface">
        <h2 className="px-4 pt-4 font-display text-title tracking-tight text-ink">Activity</h2>
        <p className="px-4 py-3 text-body text-ink-2">{beta ? "Nothing charged during beta." : "No charges yet."}</p>
      </section>
    </div>
  );
}

const fullTeam: MembersData = {
  members: [
    { userId: "owner", email: "amira@growth.co.ke", name: "Amira Hassan", role: "owner", joinedAt: "2026-01-04" },
    { userId: "admin", email: "jane@growth.co.ke", name: "Jane Wanjiku", role: "admin", joinedAt: "2026-03-12" },
    { userId: "staff", email: "peter@growth.co.ke", name: "Peter Otieno", role: "staff", joinedAt: "2026-06-02" },
  ],
  invites: [],
  seats: seatSummary({ members: 3, invites: [], included: 3 }),
  totals: { members: 3, invites: 0 },
  limits: { members: 20, invites: 20 },
};

export type BillingPreview =
  | "beta"
  | "plan"
  | "plan-annual"
  | "plan-confirm"
  | "billing"
  | "billing-empty"
  | "usage-beta"
  | "usage-paid"
  | "trial"
  | "banner"
  | "team";

export function BillingFixture({ view }: { view: BillingPreview }) {
  if (view === "plan" || view === "plan-annual" || view === "plan-confirm") {
    return (
      <SettingsPlanFrame title="Plan" activePath="/settings/plan">
        <PlanPicker
          model={growthModel(view === "plan-annual" ? "year" : "month")}
          openSeat={false}
          startConfirm={view === "plan-confirm"}
        />
      </SettingsPlanFrame>
    );
  }
  if (view === "trial") {
    const trial = trialRemaining({
      now: PREVIEW_NOW,
      trialEndsAt: "2026-10-30T09:00:00+03:00",
      secondsUsed: 120,
      minutesIncluded: 20,
    });
    return (
      <SettingsPlanFrame title="Plan" meta={trial.text} activePath="/settings/plan">
        <PlanPicker model={growthModel("month", trial.text)} openSeat={false} />
      </SettingsPlanFrame>
    );
  }
  if (view === "billing") {
    return (
      <SettingsPlanFrame title="Billing" activePath="/settings/billing">
        <OwnerInvoiceList invoices={invoiceItems(sampleInvoices)} />
      </SettingsPlanFrame>
    );
  }
  if (view === "billing-empty") {
    return (
      <SettingsPlanFrame title="Billing" activePath="/settings/billing">
        <OwnerInvoiceList invoices={[]} />
      </SettingsPlanFrame>
    );
  }
  if (view === "usage-beta" || view === "usage-paid") {
    return <UsagePreview kind={view === "usage-beta" ? "beta" : "paid"} />;
  }
  if (view === "banner") {
    const banner = pickBillingBanner(
      {
        billingStatus: "suspended",
        voicemailUntil: "2026-10-25T18:00:00+03:00",
        openInvoiceKes: 8120,
        payToken: null,
      },
      PREVIEW_NOW,
    );
    return (
      <div>
        {banner ? <BillingNote banner={banner} bar /> : null}
        <div className="pt-4">
          <h1 className={deskListTitleClass}>Calls</h1>
        </div>
      </div>
    );
  }
  if (view === "team") {
    return (
      <div className="mx-auto w-full max-w-lg">
        <PageHeader title="Team" back={{ href: "/settings", label: "Settings" }} />
        <div className="mt-6">
          <MembersPanel data={fullTeam} viewerRole="owner" viewerId="owner" />
        </div>
      </div>
    );
  }
  return (
    <SettingsPlanFrame title="Plan" activePath="/settings/plan">
      <h2 className="mt-6 text-title text-ink">Free during beta</h2>
      <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
    </SettingsPlanFrame>
  );
}

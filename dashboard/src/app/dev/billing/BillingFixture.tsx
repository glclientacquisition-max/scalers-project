"use client";

import type { ReactNode } from "react";
import { BillingNote } from "@/components/DeskBillingBanner";
import { MembersPanel } from "@/components/MembersPanel";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { PlanPicker } from "@/components/plan/PlanPicker";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import { Empty } from "@/components/ui/Empty";
import { PageHeader } from "@/components/ui/PageHeader";
import { ownerBillingSurface } from "@/lib/betaBilling";
import { pickBillingBanner } from "@/lib/billingBanner";
import { ownerBillingView } from "@/lib/billingStateModel";
import { seatSummary } from "@/lib/invites";
import { invoicePayState } from "@/lib/invoicePayState";
import type { MembersData } from "@/lib/membersLoad";
import type { OwnerInvoiceRow, OwnerPlanModel, PlanCycle, PlanSku, PublishedPlan } from "@/lib/ownerPlanLoad";
import { annualPriceKes, annualSavingKes, formatKsh, spendLimitDisplayKes } from "@/lib/planPricing";
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

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      <PageHeader title={title} back={{ href: "/settings", label: "Settings" }} />
      {children}
    </div>
  );
}

function periodLabel(invoice: OwnerInvoiceRow): string {
  if (invoice.periodStart && invoice.periodEnd) return `${invoice.periodStart} to ${invoice.periodEnd}`;
  return "";
}

function InvoiceList({ invoices }: { invoices: OwnerInvoiceRow[] }) {
  if (invoices.length === 0) {
    return <Empty title="No invoices" line="They show here when one is issued." />;
  }
  return (
    <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
      {invoices.map((invoice) => {
        const pay = invoicePayState({ status: invoice.status, payToken: invoice.payToken });
        if (pay.hidden) return null;
        return (
          <li key={invoice.id} className="px-4 py-3">
            <div className="flex items-baseline gap-3">
              <p className="min-w-0 flex-1 truncate text-body text-ink">{invoice.number}</p>
              <p className="shrink-0 text-body tabular-nums text-ink">{formatKsh(invoice.totalKes)}</p>
            </div>
            <p className="mt-0.5 text-meta text-ink-2">
              {[periodLabel(invoice), invoice.dueAt ? `Due ${invoice.dueAt}` : "", "incl. VAT"].filter(Boolean).join(" · ")}
            </p>
            {pay.label === "Paid" ? <p className="mt-1 text-meta text-ink">{pay.label}</p> : null}
            {pay.note ? <p className="mt-1 text-meta text-ink-2">{pay.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
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

function count(n: number): string {
  return n.toLocaleString("en-KE");
}

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
    .filter((row) => row.key !== "email" && row.key !== "whatsapp")
    .map((row) =>
      row.key === "sms"
        ? {
            ...row,
            label: "Message credits",
            included: messageCredits,
            used: creditsUsed,
            left: messageCredits - creditsUsed,
            note: beta ? null : "1 credit is KSh 1 on demand",
          }
        : row,
    );
  const minutesLeft = view.minutesLeft;
  const minuteMax = Math.max(0, view.minutesIncluded);
  const minuteLeftPct = minuteMax > 0 ? Math.min(100, Math.round((minutesLeft / minuteMax) * 100)) : 0;
  const spendLimit = beta ? null : spendLimitDisplayKes(null, 18000);

  return (
    <div className="max-w-3xl px-4 py-4">
      <header>
        <h1 className={deskListTitleClass}>Usage</h1>
        <p className="mt-2 text-body text-ink-2">{view.headline}</p>
      </header>
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-5">
        <p className="text-body text-ink-2">Minutes left{view.periodEndLabel ? ` until ${view.periodEndLabel}` : ""}</p>
        <p className="mt-1 font-display text-display tabular-nums text-ink">{count(minutesLeft)}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label="Minutes left">
          <div className="h-full bg-accent" style={{ width: `${minuteLeftPct}%` }} />
        </div>
        <table className="mt-6 w-full text-left text-body">
          <caption className="sr-only">What your package includes this month</caption>
          <thead className="border-b border-hairline text-ink-2">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">This month</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Included</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Used</th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">Left</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-hairline">
                <th scope="row" className="py-3 pr-3 font-normal text-ink">
                  {row.label}
                  {row.note ? <span className="block text-meta text-ink-2">{row.note}</span> : null}
                </th>
                <td className="px-2 py-3 text-right tabular-nums text-ink-2">{count(row.included)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-ink-2">{count(row.used)}</td>
                <td className="py-3 pl-2 text-right font-medium tabular-nums text-ink">{count(row.left)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="mt-6">
        <OnDemandUsagePanel
          tenantId="preview"
          enabled={!beta}
          hint={view.onDemandHint}
          locked={false}
        />
        {beta ? null : (
          <p className="mt-3 text-body text-ink-2">
            When on-demand is off and credits run out, sending stops and updates go to your Inbox only.
          </p>
        )}
        {spendLimit != null ? (
          <p className="mt-3 text-body text-ink">
            Spend limit <span className="tabular-nums">{formatKsh(spendLimit)}</span>
            <span className="text-ink-2"> Suggested until you set one.</span>
          </p>
        ) : null}
      </div>
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="font-display text-title tracking-tight text-ink">{view.ratesTitle}</h2>
        <p className="mt-3 text-body text-ink">Calls <span className="tabular-nums">KSh 26</span> a minute</p>
        <p className="mt-1 text-body text-ink">Message credits <span className="tabular-nums">KSh 1</span> each</p>
      </section>
      <section className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-surface">
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
      <Frame title="Plan">
        <PlanPicker
          model={growthModel(view === "plan-annual" ? "year" : "month")}
          openSeat={false}
          startConfirm={view === "plan-confirm"}
        />
      </Frame>
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
      <Frame title="Plan">
        <PlanPicker model={growthModel("month", trial.text)} openSeat={false} />
      </Frame>
    );
  }
  if (view === "billing") {
    return (
      <Frame title="Billing">
        <InvoiceList invoices={sampleInvoices} />
      </Frame>
    );
  }
  if (view === "billing-empty") {
    return (
      <Frame title="Billing">
        <InvoiceList invoices={[]} />
      </Frame>
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
        <div className="px-4 py-4">
          <h1 className={deskListTitleClass}>Calls</h1>
        </div>
      </div>
    );
  }
  if (view === "team") {
    return (
      <Frame title="Team">
        <div className="mt-6">
          <MembersPanel data={fullTeam} viewerRole="owner" viewerId="owner" />
        </div>
      </Frame>
    );
  }
  return (
    <Frame title="Plan">
      <h2 className="mt-6 text-title text-ink">Free during beta</h2>
      <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
    </Frame>
  );
}

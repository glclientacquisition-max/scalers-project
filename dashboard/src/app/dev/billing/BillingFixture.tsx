"use client";

import { useState } from "react";
import { AlertContactsList } from "@/components/AlertContactsList";
import { BillingNote } from "@/components/DeskBillingBanner";
import { HomeUsageSection } from "@/components/HomeUsageSection";
import { MembersPanel } from "@/components/MembersPanel";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { BillingHistory } from "@/components/plan/BillingHistory";
import { BetaInvoicesEmpty, BetaPlanSummary, betaPlanRows } from "@/components/plan/BetaPlanSummary";
import { OwnerInvoiceList } from "@/components/plan/OwnerInvoiceList";
import { PlanPicker } from "@/components/plan/PlanPicker";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { TeamSeatsNote } from "@/components/plan/TeamSeatsNote";
import { UsageSummary, type UsageListRow } from "@/components/plan/UsageSummary";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import { ownerBillingSurface } from "@/lib/betaBilling";
import { pickBillingBanner } from "@/lib/billingBanner";
import { mapBillingHistory, type BillingHistoryBody } from "@/lib/billingHistory";
import { lowBalanceNotice, ownerBillingView, type OwnerBillingView } from "@/lib/billingStateModel";
import { seatSummary } from "@/lib/invites";
import { messageCreditsUsage, type CreditBurns } from "@/lib/messageCredits";
import type { MembersData } from "@/lib/membersLoad";
import type { OwnerPlanModel, PlanCycle, PlanSku, PublishedPlan } from "@/lib/ownerPlanLoad";
import { planEntry } from "@/lib/planEntry";
import { annualPriceKes, annualSavingKes, formatKsh, type SeatOffer } from "@/lib/planPricing";
import type { TeamDirectoryEntry } from "@/lib/supabase";
import { trialRemaining } from "@/lib/trialRemaining";
import type { BillingPreview } from "./previews";

const PREVIEW_NOW = new Date("2026-10-18T09:00:00+03:00");
const PERIOD_END = "2026-11-01T00:00:00+03:00";

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

/** QA business: Growth, paid monthly, 260 of 800 minutes used. */
function growthModel({
  cycle = "month",
  trialText = null,
  seatsUsed = 3,
}: { cycle?: PlanCycle; trialText?: string | null; seatsUsed?: number } = {}): OwnerPlanModel {
  return {
    freeBeta: false,
    billingStatus: trialText ? "trialing" : "active",
    surface: ownerBillingSurface(trialText ? "trialing" : "active"),
    currentSku: "growth",
    currentMonthlyKes: 18000,
    cycle,
    plans,
    seatsUsed,
    seatsIncluded: 8,
    minutesIncluded: 800,
    minutesUsed: 260,
    trialText,
    onDemandLocked: Boolean(trialText),
    invoices: [],
    notices: [],
    periodEndLabel: "31 Oct",
    dayOfPeriod: 18,
    daysInPeriod: 31,
    daysLeft: 14,
    extraSeatMonthlyKes: 500,
    extraSeats: 0,
    seatUnitKes: 500,
    periodEndMonth: "October",
    nextPeriodStartLabel: "1 Nov",
    banner: null,
  };
}

const sampleHistory: BillingHistoryBody = {
  invoices: [
    { id: "inv-1042", number: "SCL-1042", status: "open", due_at: "2026-10-09T00:00:00+03:00", total_due: "KSh 18,000", amount_paid: "KSh 0", balance: "KSh 18,000", pay_link_path: "/api/billing/invoices/inv-1042/pay-link" },
    { id: "inv-1040", number: "SCL-1040", status: "open", due_at: "2026-10-05T00:00:00+03:00", total_due: "KSh 300,000", amount_paid: "KSh 150,000", balance: "KSh 150,000", pay_link_path: "/api/billing/invoices/inv-1040/pay-link" },
    { id: "inv-1039", number: "SCL-1039", status: "open", due_at: "2026-10-01T00:00:00+03:00", total_due: "KSh -1,000", amount_paid: "KSh 0", balance: "KSh 0", pay_link_path: "/api/billing/invoices/inv-1039/pay-link" },
    { id: "inv-1038", number: "SCL-1038", status: "paid", due_at: "2026-09-09T00:00:00+03:00", total_due: "KSh 18,000", amount_paid: "KSh 18,000", balance: "KSh 0", pay_link_path: null },
  ],
};

const noop = () => {};
const sampleInvoices = mapBillingHistory(sampleHistory, { fromPay: false }).map((row) => ({ ...row, onPay: noop }));

const BURNS: CreditBurns = { sms: 1, whatsapp: 2, email: 1 };

/** Beta tenant: Starter, 297 of 300 minutes, every seat taken, a few messages sent. */
function betaView(): OwnerBillingView {
  return ownerBillingView({
    state: {
      package_state: "active",
      package_name: "Starter",
      included_minutes: 300,
      used_seconds: 297 * 60,
      sms_included: 50,
      sms_used: 18,
      on_demand_enabled: false,
      mode_label: "beta",
      period_end: PERIOD_END,
    },
    monthlyPriceKes: null,
    smsMessages: null,
    seatsIncluded: 3,
    seatsUsed: 3,
    messagesSent: { email: 9, whatsapp: 14 },
  });
}

const betaCredits = () => messageCreditsUsage(1000, BURNS, betaView().messageUse);

/** QA business: Growth, 680 of 800 minutes (warns), 5 of 8 seats. */
function paidView(): OwnerBillingView {
  return ownerBillingView({
    state: {
      package_state: "active",
      package_name: "Growth",
      included_minutes: 800,
      used_seconds: 680 * 60,
      sms_included: 2500,
      sms_used: 420,
      on_demand_enabled: true,
      mode_label: "metered",
      period_end: PERIOD_END,
    },
    monthlyPriceKes: 18000,
    smsMessages: null,
    seatsIncluded: 8,
    seatsUsed: 5,
    messagesSent: { email: 64, whatsapp: 118 },
  });
}

function usageRows(view: OwnerBillingView, includedCredits: number) {
  const seat = view.rows.find((row) => row.key === "seats");
  const creditUsage = messageCreditsUsage(includedCredits, BURNS, view.messageUse);
  return {
    seats: seat ? { key: "seats", label: "Seats", included: seat.included, used: seat.used, left: seat.left } : null,
    credits: creditUsage ? ({ key: "credits", label: "Message credits", ...creditUsage } satisfies UsageListRow) : null,
  };
}

function UsagePreview({ kind }: { kind: "beta" | "paid" }) {
  const beta = kind === "beta";
  const view = beta ? betaView() : paidView();
  const rows = usageRows(view, beta ? 1000 : 2500);
  return (
    <UsageSummary
      minutesLeft={view.minutesLeft}
      minutesIncluded={view.minutesIncluded}
      minutesUsed={view.minutesUsed}
      minutesUnderOne={view.minutesUnderOne}
      minutesOverLabel={view.minutesOverLabel}
      periodEndLabel={view.periodEndLabel}
      beta={beta}
      planLine={beta ? null : `Growth · ${formatKsh(18000)} a month`}
      entry={planEntry(beta ? "beta" : "active", true)}
      seats={rows.seats}
      credits={rows.credits}
    >
      {beta ? null : (
        <>
          <OnDemandUsagePanel tenantId="preview" enabled extraMinuteKes={26} />
          <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            <h2 className="px-4 pt-4 font-display text-title tracking-tight text-ink">Activity</h2>
            <table className="mt-2 w-full text-left text-body">
              <thead className="border-b border-hairline text-ink-2">
                <tr>
                  <th scope="col" className="px-4 py-2 text-meta font-semibold">When</th>
                  <th scope="col" className="px-4 py-2 text-meta font-semibold">Kind</th>
                  <th scope="col" className="px-4 py-2 text-right text-meta font-semibold">KSh</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-hairline/70">
                  <td className="whitespace-nowrap px-4 py-2 text-ink-2">1 Oct</td>
                  <td className="px-4 py-2 font-medium text-ink">Line fee</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">-1,500</td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </UsageSummary>
  );
}

const seatOffer: SeatOffer = {
  extraSeatMonthlyKes: 500,
  extraSeats: 0,
  cycle: "month",
  daysLeft: 14,
  daysInPeriod: 31,
  seatUnitKes: 500,
  periodEndMonth: "October",
  nextPeriodStartLabel: "1 Nov",
};

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
  seatOffer,
};

const ALERT_FLAGS = [
  { key: "receives_escalation", label: "Urgent" },
  { key: "receives_inbox", label: "Follow-up" },
  { key: "receives_ops", label: "Ops" },
] as const;

function BetaTeamPreview() {
  const [team, setTeam] = useState<TeamDirectoryEntry[]>([
    { name: "Wanjiru Kamau", role: "Owner", phone: "+254711000111", receives_escalation: true, receives_inbox: true, receives_ops: true },
    { name: "Otieno Ouma", role: "Supervisor", phone: "+254722000222", receives_escalation: true },
    { name: "Achieng Atieno", role: "Cleaner", phone: "+254733000333", receives_inbox: true },
  ]);
  return (
    <SettingsPlanFrame title="Team" activePath="/settings?tab=train&panel=team">
      <div className="mt-4 space-y-4">
        <TeamSeatsNote included={3} entry={planEntry("beta", true)} />
        <AlertContactsList
          team={team}
          flags={ALERT_FLAGS}
          note="Channels follow How we notify."
          addLabel="Add person"
          onChange={(index, key, value) =>
            setTeam((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
          }
          onAdd={() => setTeam((prev) => [...prev, { name: "", role: "", phone: "" }])}
          onRemove={(index) => setTeam((prev) => prev.filter((_, i) => i !== index))}
        />
      </div>
    </SettingsPlanFrame>
  );
}

function HomeBetaPreview() {
  const view = betaView();
  const low = lowBalanceNotice(view, betaCredits());
  return (
    <div className="mx-auto w-full max-w-sm pt-4">
      <aside className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <section aria-label="Line" className="px-4 py-4">
          <p className="text-body font-medium text-ink">Line is live</p>
        </section>
        <HomeUsageSection
          minutesLeft={view.minutesLeft}
          packLabel={view.shortLabel}
          minuteStatus={null}
          lowNotice={low.lowNotice}
          lowNoticeNote={low.lowNoticeNote}
          showLink={Boolean(low.lowNotice)}
        />
      </aside>
    </div>
  );
}

function PlanPreview({ model, startConfirm = null }: { model: OwnerPlanModel; startConfirm?: PlanSku | null }) {
  return (
    <SettingsPlanFrame title="Plan" meta={model.trialText} activePath="/settings/plan">
      <PlanPicker model={model} openSeat={false} startConfirm={startConfirm} />
    </SettingsPlanFrame>
  );
}

export function BillingFixture({ view }: { view: BillingPreview }) {
  switch (view) {
    case "plan":
      return <PlanPreview model={growthModel()} />;
    case "plan-annual":
      return <PlanPreview model={growthModel({ cycle: "year" })} />;
    case "plan-upgrade":
      return <PlanPreview model={growthModel()} startConfirm="scale" />;
    case "plan-downgrade":
      return <PlanPreview model={growthModel()} startConfirm="starter" />;
    case "plan-seat-block":
      return <PlanPreview model={growthModel({ seatsUsed: 5 })} startConfirm="starter" />;
    case "trial": {
      const trial = trialRemaining({
        now: PREVIEW_NOW,
        trialEndsAt: "2026-10-30T09:00:00+03:00",
        secondsUsed: 120,
        minutesIncluded: 20,
      });
      return <PlanPreview model={growthModel({ trialText: trial.text })} />;
    }
    case "billing":
      return (
        <SettingsPlanFrame title="Billing" activePath="/settings/billing">
          <OwnerInvoiceList invoices={sampleInvoices} />
        </SettingsPlanFrame>
      );
    case "billing-empty":
      return (
        <SettingsPlanFrame title="Billing" activePath="/settings/billing">
          <BillingHistory fromPay={false} />
        </SettingsPlanFrame>
      );
    case "usage-paid":
      return <UsagePreview kind="paid" />;
    case "usage-beta":
      return <UsagePreview kind="beta" />;
    case "team-paid":
      return (
        <SettingsPlanFrame title="Team" activePath="/settings?tab=train&panel=team">
          <div className="mt-4">
            <MembersPanel data={fullTeam} viewerRole="owner" viewerId="owner" planEntry={planEntry("active", true)} />
          </div>
        </SettingsPlanFrame>
      );
    case "banner": {
      const banner = pickBillingBanner(
        { billingStatus: "suspended", voicemailUntil: "2026-10-25T18:00:00+03:00", openInvoiceKes: 8120 },
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
    case "plan-beta": {
      const beta = betaView();
      return (
        <SettingsPlanFrame title="Plan" activePath="/settings/plan">
          <BetaPlanSummary planName={beta.packageName} periodEndLabel={beta.periodEndLabel} rows={betaPlanRows(beta, betaCredits())} />
        </SettingsPlanFrame>
      );
    }
    case "billing-beta":
      return (
        <SettingsPlanFrame title="Billing" activePath="/settings/billing">
          <BetaInvoicesEmpty />
        </SettingsPlanFrame>
      );
    case "home-beta":
      return <HomeBetaPreview />;
    case "team-beta":
      return <BetaTeamPreview />;
  }
}

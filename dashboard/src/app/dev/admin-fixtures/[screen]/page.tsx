// SHOTS BRANCH ONLY (shots/redesign-1054-1068). Never merge. Synthetic data, no Supabase, no auth.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminAttentionV2 } from "@/components/admin/v2/AdminAttentionV2";
import { AdminBillingHomeV2 } from "@/components/admin/v2/AdminBillingHomeV2";
import { AdminBusinessesV2 } from "@/components/admin/v2/AdminBusinessesV2";
import { AdminNumbersV2 } from "@/components/admin/v2/AdminNumbersV2";
import { AdminQualityV2 } from "@/components/admin/v2/AdminQualityV2";
import { AdminInsightsV2 } from "@/components/admin/v2/AdminInsightsV2";
import { AdminUsageV2 } from "@/components/admin/v2/AdminUsageV2";
import { StepUpHost } from "@/components/ops/StepUpHost";
import { buildInsights } from "@/lib/ops/insightsView";
import type { OpsSignal } from "@/lib/platformOpsModel";
import { ADMIN_ATTENTION } from "../../fixtures/adminAttention";
import { ADMIN_BUSINESSES, ADMIN_BUSINESS_BADGES, ADMIN_BUSINESS_CALLS, ADMIN_BUSINESS_PANES } from "../../fixtures/adminBusinesses";
import { ADMIN_INVOICES, ADMIN_INVOICES_NOW } from "../../fixtures/adminInvoices";
import { ADMIN_NUMBERS, ADMIN_NUMBERS_MOVE_TARGETS, ADMIN_NUMBERS_NOW, ADMIN_NUMBERS_PLAIN_HOLD, ADMIN_NUMBERS_WAITING } from "../../fixtures/adminNumbers";
import { adminQualityRows } from "../../fixtures/adminQuality";
import { ADMIN_INSIGHTS_FACTS, ADMIN_INSIGHTS_NAMES, ADMIN_INSIGHTS_NOW } from "../../fixtures/adminInsights";
import { ADMIN_USAGE, ADMIN_USAGE_NOW } from "../../fixtures/adminUsage";
import { fixtureReleases } from "../../quality/fixtures";

export const instant = false;
type State = "live" | "warning" | "empty" | "error";
const STATES: State[] = ["live", "warning", "empty", "error"];

const SIGNALS = (s: State): OpsSignal[] =>
  s === "warning"
    ? ([{ kind: "speech", active: true, critical: false, title: "Speech replies slow (test data)", detail: "Synthetic: TTS p95 2.8 s for 12 min" }] as unknown as OpsSignal[])
    : [];

const USAGE_ROWS = (s: State) =>
  ADMIN_BUSINESSES.filter((b) => b.status === "active").map((b, i) => ({
    tenantId: b.id,
    includedMinutes: 500,
    usedSeconds: Math.round(500 * 60 * (s === "warning" ? 0.85 + (i % 4) * 0.06 : 0.15 + ((i * 17) % 60) / 100)),
    packageName: "Starter",
  }));

function Banner({ screen, state }: { screen: string; state: State }) {
  return (
    <div role="note" style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999, background: "#7c2d12", color: "#fff", font: "600 11px/1.3 system-ui", padding: "4px 8px", borderRadius: 6, pointerEvents: "none" }}>
      Test data · synthetic · {screen} · {state}
    </div>
  );
}

function body(screen: string, state: State, sp: Record<string, string | undefined>) {
  const empty = state === "empty";
  const warn = state === "warning";
  switch (screen) {
    case "attention": {
      const items = empty ? [] : warn ? ADMIN_ATTENTION.filter((i) => i.kind !== "overdue") : ADMIN_ATTENTION;
      return <AdminAttentionV2 items={items} callsFixture={ADMIN_BUSINESS_CALLS} signals={SIGNALS(state)} />;
    }
    case "billing-home": {
      const rows = empty ? [] : warn ? ADMIN_INVOICES.filter((r) => r.status === "open" || r.status === "uncollectible") : ADMIN_INVOICES;
      return <AdminBillingHomeV2 rows={rows} nowIso={ADMIN_INVOICES_NOW} />;
    }
    case "businesses": {
      const list = empty ? [] : warn ? ADMIN_BUSINESSES.filter((b) => b.status !== "active" || ADMIN_BUSINESSES.indexOf(b) % 3 === 0) : ADMIN_BUSINESSES;
      return <AdminBusinessesV2 businesses={list} badges={ADMIN_BUSINESS_BADGES} usage={USAGE_ROWS(state)} paneFixture={ADMIN_BUSINESS_PANES} />;
    }
    case "numbers": {
      const rows = empty ? [] : warn ? ADMIN_NUMBERS.filter((r) => r.status === "quarantine" || r.status === "disabled" || r.status === "reserved") : [ADMIN_NUMBERS_PLAIN_HOLD, ...ADMIN_NUMBERS];
      return (
        <>
          <AdminNumbersV2 rows={rows} waiting={empty ? [] : ADMIN_NUMBERS_WAITING} moveTargets={ADMIN_NUMBERS_MOVE_TARGETS} nowIso={ADMIN_NUMBERS_NOW} holdPolicy={{ columnsPresent: true, enabled: true, defaultDays: 14, reactivationFeeKes: null }} />
          <StepUpHost />
        </>
      );
    }
    case "quality": {
      const all = adminQualityRows("7d");
      const rows = empty ? [] : warn ? all.filter((r) => r.dropping || (r.score ?? 100) < 70) : all;
      return <AdminQualityV2 base="/dev/admin-fixtures/quality" range="7d" rows={rows} business={null} call={null} callBusiness={null} releases={empty ? [] : fixtureReleases()} />;
    }
    case "insights": {
      const days = 7;
      const now = Date.parse(ADMIN_INSIGHTS_NOW);
      let rows = ADMIN_INSIGHTS_FACTS.filter((r) => Date.parse(r.createdAt) >= now - days * 86400_000);
      if (empty) rows = [];
      if (warn) rows = rows.map((r, i) => (i % 2 ? { ...r, resolution: "abandoned" } : r)) as typeof rows;
      return <AdminInsightsV2 data={buildInsights(rows, ADMIN_INSIGHTS_NAMES, days, now)} />;
    }
    case "usage-meter": {
      const k = warn ? 1 : 0.55;
      const calls = empty ? [] : ADMIN_USAGE.calls.map((c) => ({ ...c, durationSeconds: Math.round(c.durationSeconds * k) }));
      const data = { ...ADMIN_USAGE, calls, meteredSeconds: calls.reduce((a, c) => a + c.durationSeconds, 0) };
      return <AdminUsageV2 data={data} tenantId="00000000-0000-4000-8000-000000000001" currentPeriod nowIso={ADMIN_USAGE_NOW} />;
    }
    default:
      return null;
  }
  void sp;
}

/** /dev/admin-fixtures/<screen>?state=live|warning|empty|error. 404 unless NODE_ENV=development. */
export default async function DevAdminFixturePage({ params, searchParams }: { params: Promise<{ screen: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  if (process.env.NODE_ENV !== "development") notFound();
  const { screen } = await params;
  const sp = await searchParams;
  const state = (STATES as string[]).includes(sp.state ?? "") ? (sp.state as State) : "live";
  const content = state === "error" ? <AdminSetupError /> : body(screen, state, sp);
  if (content === null) notFound();
  return (
    <AdminShell operatorName="test-operator" v2>
      {content}
      <Banner screen={screen} state={state} />
    </AdminShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, KpiTile, Money, OpsConfirm, OpsSkeleton, PageHeader, SplitLayout, SplitPane, StatusPill, type ConfirmStrength, type OpsTone } from "@/components/ops";

const TONES: [OpsTone, string][] = [["ok", "Live"], ["info", "Scheduled"], ["warn", "Low balance"], ["danger", "Failed"], ["neutral", "Archived"], ["beta", "Beta"]];
const SAMPLE = [0, 1250, -1200, 20000, 1000000];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-ops-2">
      <h2 className="text-ops-heading text-ink">{title}</h2>
      {children}
    </section>
  );
}

type Shop = { id: string; name: string; plan: string; tone: OpsTone; state: string; used: number; owed: number; calls: number };
const SHOPS: Shop[] = [
  { id: "jirani", name: "Jirani Cleaning", plan: "Starter", tone: "warn", state: "Low balance", used: 92, owed: 1500, calls: 41 },
  { id: "esga", name: "Esga Home Services", plan: "Growth", tone: "ok", state: "Live", used: 64, owed: 0, calls: 118 },
  { id: "bachs", name: "Bachs Movers", plan: "Growth", tone: "danger", state: "Failed payment", used: 100, owed: 4500, calls: 77 },
  { id: "kesho", name: "Kesho Laundry", plan: "Starter", tone: "info", state: "Scheduled", used: 12, owed: 0, calls: 9 },
  { id: "mwangaza", name: "Mwangaza Salon", plan: "Pro", tone: "ok", state: "Live", used: 48, owed: 0, calls: 203 },
  { id: "tumaini", name: "Tumaini Plumbing", plan: "Starter", tone: "neutral", state: "Archived", used: 0, owed: 0, calls: 0 },
  { id: "baraka", name: "Baraka Auto Care", plan: "Growth", tone: "ok", state: "Live", used: 71, owed: 0, calls: 96 },
  { id: "nuru", name: "Nuru Dental", plan: "Pro", tone: "warn", state: "Low balance", used: 88, owed: 2500, calls: 154 },
  { id: "pwani", name: "Pwani Pest Control", plan: "Starter", tone: "ok", state: "Live", used: 35, owed: 0, calls: 22 },
  { id: "umoja", name: "Umoja Electricals", plan: "Growth", tone: "info", state: "Scheduled", used: 5, owed: 0, calls: 3 },
  { id: "safari", name: "Safari Car Hire", plan: "Pro", tone: "ok", state: "Live", used: 57, owed: 0, calls: 187 },
  { id: "zuri", name: "Zuri Beauty Bar", plan: "Starter", tone: "danger", state: "Failed payment", used: 100, owed: 2500, calls: 64 },
  { id: "kilimo", name: "Kilimo Agrovet", plan: "Starter", tone: "ok", state: "Live", used: 29, owed: 0, calls: 18 },
  { id: "imara", name: "Imara Security", plan: "Growth", tone: "ok", state: "Live", used: 66, owed: 0, calls: 131 },
  { id: "hodari", name: "Hodari Fitness", plan: "Starter", tone: "warn", state: "Low balance", used: 95, owed: 1500, calls: 47 },
  { id: "amani", name: "Amani Vet Clinic", plan: "Pro", tone: "ok", state: "Live", used: 43, owed: 0, calls: 109 },
  { id: "jua", name: "Jua Solar Installers", plan: "Growth", tone: "ok", state: "Live", used: 52, owed: 0, calls: 88 },
  { id: "rafiki", name: "Rafiki Tutors", plan: "Starter", tone: "info", state: "Scheduled", used: 0, owed: 0, calls: 0 },
  { id: "tembo", name: "Tembo Hardware", plan: "Pro", tone: "ok", state: "Live", used: 61, owed: 0, calls: 142 },
  { id: "neema", name: "Neema Bakery", plan: "Starter", tone: "warn", state: "Low balance", used: 90, owed: 1500, calls: 38 },
  { id: "simba", name: "Simba Courier", plan: "Growth", tone: "ok", state: "Live", used: 74, owed: 0, calls: 121 },
  { id: "maji", name: "Maji Water Delivery", plan: "Starter", tone: "ok", state: "Live", used: 33, owed: 0, calls: 27 },
  { id: "kito", name: "Kito Jewellers", plan: "Pro", tone: "danger", state: "Failed payment", used: 100, owed: 6500, calls: 59 },
  { id: "upendo", name: "Upendo Daycare", plan: "Starter", tone: "ok", state: "Live", used: 21, owed: 0, calls: 14 },
];

/** Grow-plan pane: all four sections. Kesho shows how empty sections drop out. */
function paneFor(s: Shop) {
  const facts = [
    { label: "Plan", value: s.plan },
    { label: "State", value: <StatusPill tone={s.tone}>{s.state}</StatusPill> },
    { label: "Minutes used", value: `${s.used}%` },
    { label: "Owed", value: <Money value={s.owed} /> },
    { label: "Calls this month", value: String(s.calls) },
  ];
  if (s.id === "kesho") return { facts };
  return {
    facts,
    changes: [
      { label: "Plan", from: s.plan, to: "Growth" },
      { label: "Included minutes", from: "300", to: "900" },
      { label: "Monthly price", from: <Money value={2500} />, to: <Money value={6500} /> },
      { label: "Starts", from: "Now", to: "1 Nov" },
    ],
    history: [
      { when: "21 Oct 14:02", what: "Minutes at 90%", who: "system" },
      { when: "18 Oct 09:40", what: "Paid invoice INV-1043", who: "owner" },
      { when: "02 Oct 11:15", what: "Moved to " + s.plan, who: "alvin" },
    ],
    related: [
      { label: "Invoice INV-1043", href: "#inv-1043", meta: <Money value={2500} /> },
      { label: "Wallet ledger", href: "#ledger", meta: "12 entries" },
      { label: "Line +254 20 765 0000", href: "#line", meta: "Live" },
    ],
  };
}

function SplitDemo() {
  const [sel, setSel] = useState<string | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("pane");
    if (q) setSel(q);
  }, []);
  const shop = SHOPS.find((x) => x.id === sel) ?? null;
  const close = () => { setSel(null); setCode(""); };
  const list = (
    <table className="w-full min-w-[640px] text-ops-body">
      <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
        <tr className="h-ops-row border-b border-hairline">
          <th className="px-ops-3 text-start font-normal">Business</th>
          <th className="px-ops-3 text-start font-normal">Plan</th>
          <th className="px-ops-3 text-start font-normal">State</th>
          <th className="px-ops-3 text-end font-normal">Minutes</th>
          <th className="px-ops-3 text-end font-normal">Calls</th>
          <th className="px-ops-3 text-end font-normal">Owed</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline bg-surface">
        {SHOPS.map((s) => (
          <tr
            key={s.id}
            aria-selected={sel === s.id}
            onClick={() => { setSel(s.id); setCode(""); }}
            className={["h-ops-touch cursor-pointer md:h-ops-row", sel === s.id ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
          >
            <td className="px-ops-3 text-ink"><button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{s.name}</button></td>
            <td className="px-ops-3 text-ink-2">{s.plan}</td>
            <td className="px-ops-3"><StatusPill tone={s.tone}>{s.state}</StatusPill></td>
            <td className="px-ops-3 text-end tabular-nums text-ink-2">{s.used}%</td>
            <td className="px-ops-3 text-end tabular-nums text-ink-2">{s.calls}</td>
            <td className="px-ops-3 text-end"><Money value={s.owed} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const sections = shop ? paneFor(shop) : {};
  const footer = shop ? (
    <div className="flex w-full flex-col gap-ops-2">
      <label className="flex flex-col gap-1">
        <span className="text-ops-label text-ink">Type GROW to confirm</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="ops-field text-ink" />
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={close}>Cancel</Button>
        <Button variant="primary" size="md" disabled={code.trim() !== "GROW"} onClick={close}>Move to Growth</Button>
      </div>
    </div>
  ) : undefined;
  return (
    <SplitLayout
      list={list}
      pane={<SplitPane open={!!shop} onClose={close} title={shop ? `Move ${shop.name} to Growth?` : ""} subtitle={shop ? "Takes effect at the next billing period." : undefined} footer={footer} {...sections} />}
    />
  );
}

export function KitClient() {
  const [open, setOpen] = useState<ConfirmStrength | null>(null);
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-5">
      <PageHeader title="Ops kit" count={9} actions={<StatusPill tone="info">Staging</StatusPill>} />

      <Section title="Status">
        <div className="flex flex-wrap gap-ops-2">{TONES.map(([t, w]) => <StatusPill key={t} tone={t}>{w}</StatusPill>)}</div>
      </Section>

      <Section title="Money">
        <ul className="divide-y divide-hairline rounded-lg bg-surface">
          {SAMPLE.map((v) => (
            <li key={v} className="flex h-ops-touch items-center justify-between px-ops-3 md:h-ops-row">
              <span className="text-ops-label text-ink-2">Exact / compact</span>
              <span className="flex gap-ops-4"><Money value={v} /><Money value={v} compact className="text-ink-2" /></span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Split pane (bottom sheet on phones)">
        <SplitDemo />
      </Section>

      <Section title="KPI tiles">
        <div className="ops-tiles">
          <KpiTile label="Collected this month" value={<Money value={184500} compact />} delta={4.2} trend={[3, 4, 4, 6, 5, 7, 8]} />
          <KpiTile label="Calls today" value="312" delta={-12} trend={[9, 8, 8, 6, 7, 5, 4]} />
          <KpiTile label="Live businesses" value="27" />
          <KpiTile label="Unpaid invoices" value={<Money value={0} />} delta={0} />
          <KpiTile label="Failed payments" value="2" delta={1} trend={[0, 0, 1, 0, 1, 1, 2]} />
          <KpiTile label="Minutes used" value="61%" delta={3.1} trend={[40, 44, 47, 52, 55, 58, 61]} />
        </div>
      </Section>

      <Section title="Loading">
        <div className="ops-tiles" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg bg-surface p-ops-3">
              <OpsSkeleton className="h-3 w-2/3" /><OpsSkeleton className="h-7 w-1/2" /><OpsSkeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Empty and error">
        <EmptyState title="No unpaid invoices. New ones show here on the 1st." />
        <ErrorState title="Couldn't load invoices." onRetry={() => undefined} />
      </Section>

      <Section title="Confirm (bottom sheet on phones, side drawer from md)">
        <div className="flex flex-wrap gap-ops-2">
          <Button variant="tonal" size="sm" onClick={() => setOpen("light")}>Light</Button>
          <Button variant="tonal" size="sm" onClick={() => setOpen("money")}>Money</Button>
          <Button variant="tonal" size="sm" onClick={() => setOpen("destructive")}>Destructive</Button>
        </div>
      </Section>

      <OpsConfirm open={open === "light"} strength="light" title="Move to Growth?" confirmLabel="Move" onClose={() => setOpen(null)} onConfirm={() => setOpen(null)}>
        Jirani Cleaning moves to Growth at the end of this period.
      </OpsConfirm>
      <OpsConfirm open={open === "money"} strength="money" amount={1500} title="Grant minutes?" confirmLabel="Grant" onClose={() => setOpen(null)} onConfirm={() => setOpen(null)}>
        Adds 30 minutes to Jirani Cleaning for this period.
      </OpsConfirm>
      <OpsConfirm open={open === "destructive"} strength="destructive" typeToConfirm="REMOVE" title="Remove package now?" confirmLabel="Remove" onClose={() => setOpen(null)} onConfirm={() => setOpen(null)}>
        Jirani Cleaning loses its included minutes today. This can&apos;t be undone.
      </OpsConfirm>
    </div>
  );
}

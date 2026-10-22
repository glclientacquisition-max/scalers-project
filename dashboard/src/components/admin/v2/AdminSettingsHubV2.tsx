import Link from "next/link";
import { billingSwitches, holdSettings, type HubValue, type SettingsHubRaw } from "@/lib/ops/settingsHubView";
import { PageHeader, StatusPill } from "@/components/ops";
import "@/styles/ops.css";

const WHEN = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

function Rows({ items }: { items: HubValue[] }) {
  return (
    <ul className="divide-y divide-hairline bg-surface">
      {items.map((v) => (
        <li key={v.label} className="grid grid-cols-1 gap-1 px-ops-3 py-ops-2 md:grid-cols-[14rem_9rem_1fr] md:items-center md:gap-ops-4">
          <span className="flex items-center justify-between gap-2 font-semibold text-ink md:block">
            {v.label}
            <span className="tabular-nums font-normal md:hidden">{v.value}</span>
          </span>
          <span className="hidden tabular-nums text-ink md:block">{v.value}</span>
          <span className="flex items-center justify-between gap-2 text-ops-label text-ink-2">
            <span>{v.note}</span>
            {v.state === "set" ? null : <StatusPill tone={v.state === "placeholder" ? "warn" : "neutral"}>{v.state === "placeholder" ? "Placeholder" : "No setting"}</StatusPill>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="flex h-ops-row items-center justify-between px-ops-3 text-ops-label text-ink-2">
        <span className="font-semibold uppercase tracking-wide">{title}</span>
        <span>{meta}</span>
      </h2>
      {children}
    </section>
  );
}

/** Settings hub (ADMIN_V2): hold switch, hold length, reactivation fee, then billing switches. Read-only. */
export function AdminSettingsHubV2({ raw }: { raw: SettingsHubRaw | null }) {
  const hold = holdSettings(raw);
  const billing = billingSwitches(raw);
  const missing = [...hold, ...billing].filter((v) => v.state !== "set").length;
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-4 pe-ops-4 text-ops-body">
      <PageHeader
        title="General"
        actions={<StatusPill tone="neutral">Read-only</StatusPill>}
      />
      <p className="flex flex-wrap justify-between gap-x-ops-4 gap-y-1 text-ink-2">
        <span><span className="font-semibold text-ink">{missing ? `${missing} without a stored setting` : "All settings stored"}</span> · changes go through a reviewed release, not this page</span>
        <span className="tabular-nums">{raw?.updated_at ? `Last changed ${WHEN.format(new Date(raw.updated_at))}` : "Never changed"}</span>
      </p>
      <Section title="Suspension and hold" meta="what happens when a line stops">
        <Rows items={hold} />
      </Section>
      <Section title="A line after it stops" meta="in order, using the values above">
        <ol className="grid grid-cols-1 divide-y divide-hairline bg-surface md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            ["1", "Trial ends or line suspended", "Calls still ring through."],
            ["2", `Voicemail hold · ${hold[1].value}`, "Callers can leave a message."],
            ["3", "Not-available message", "Callers hear the line is off."],
            ["4", `Number released · ${hold[2].value}`, "Held before anyone else gets it."],
          ].map(([n, title, note]) => (
            <li key={n} className="flex min-h-[5.5rem] flex-col gap-1 px-ops-3 py-ops-3">
              <span className="text-ops-label tabular-nums text-ink-2">Step {n}</span>
              <span className="font-semibold text-ink">{title}</span>
              <span className="text-ops-label text-ink-2">{note}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Billing switches" meta="read from the billing settings row">
        <Rows items={billing} />
      </Section>
      <Section title="More settings" meta="other tabs">
        <ul className="grid grid-cols-1 divide-y divide-hairline bg-surface md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            ["/admin/settings/services", "Services", "Service list businesses pick from"],
            ["/admin/settings/voices", "Voices", "Assistant voices"],
            ["/admin/settings/audit", "Audit log", "Every admin change"],
          ].map(([href, label, note]) => (
            <li key={href}>
              <Link href={href} className="flex min-h-ops-touch flex-col justify-center px-ops-3 py-ops-2 hover:bg-surface-2">
                <span className="font-semibold text-ink">{label}</span>
                <span className="text-ops-label text-ink-2">{note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

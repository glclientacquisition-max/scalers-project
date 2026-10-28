import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { DevAdminKb } from "../DevSafeMode";
import { fixtureTakeMessages } from "../fixtures";

export const instant = false;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Slice D1: the Business pane brain block with Take messages only (ADMIN_V2 shell). DASHBOARD_OPEN=true only. ?state=off | on | owner | env */
export default async function DevSafeModeAdminPage({ searchParams }: Props) {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const p = (await searchParams) || {};
  const raw = one(p.state);
  return (
    <AdminShell operatorName="alvin" v2>
      <section className="max-w-xl rounded-xl bg-surface p-ops-4" data-dev-admin-kb="">
        <h2 className="mb-ops-3 text-ops-heading text-ink">Sparkle Home Cleaners · Calls &amp; quality</h2>
        <DevAdminKb takeMessages={fixtureTakeMessages(raw === "on" ? "support" : raw === "owner" ? "owner" : raw)} />
      </section>
    </AdminShell>
  );
}

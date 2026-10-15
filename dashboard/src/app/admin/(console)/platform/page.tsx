import { Suspense } from "react";
import { cache } from "react";
import { AdminOpsNotices, AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import {
  CallStatsStrip,
  CallsBanner,
  CardSkeleton,
  FixList,
  HostingList,
  LinesList,
  PlatformHeader,
  ProviderColumn,
  SectionHead,
  type HostingRow,
} from "@/components/platform/PlatformSections";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadCallStats, loadLines, loadPlatformHealth } from "@/lib/platformHealthData";
import { evaluatePlatformOps } from "@/lib/platformOps";
import { buildFixList, computeBanner } from "@/lib/providerHealthModel";

export const instant = false;

// One load per request, shared by every section below.
const getCallStats = cache(() => loadCallStats());
const getLines = cache(() => loadLines());
const getHealth = cache(async () => {
  const stats = await getCallStats();
  return loadPlatformHealth(stats === null ? false : true);
});
const getOps = cache(() => evaluatePlatformOps());

async function HeaderSection() {
  const health = await getHealth();
  return <PlatformHeader checkedAt={health.checkedAt} />;
}

async function BannerSection() {
  const [health, lines] = await Promise.all([getHealth(), getLines()]);
  return <CallsBanner banner={computeBanner(health.prod, lines?.pinned ?? null)} />;
}

async function StatsSection() {
  return <CallStatsStrip stats={await getCallStats()} />;
}

async function FixSection() {
  const [health, ops] = await Promise.all([getHealth(), getOps().catch(() => null)]);
  return (
    <div className="space-y-2">
      {ops ? <AdminOpsNotices notices={ops.notices.filter((n) => n.status === "open")} /> : null}
      <FixList items={buildFixList([...health.prod, ...health.staging])} />
    </div>
  );
}

async function ProvidersSection() {
  const health = await getHealth();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ProviderColumn label="Production" cards={health.prod} sha={health.prodGit.sha} />
      <ProviderColumn label="Staging" cards={health.staging} sha={health.stagingGit.sha} />
    </div>
  );
}

async function LinesSection() {
  const lines = await getLines();
  return <LinesList lines={lines?.rows ?? null} />;
}

async function HostingSection() {
  const health = await getHealth();
  const vercelSha = String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
  const stats = await getCallStats();
  const rows: HostingRow[] = [
    {
      name: "Railway",
      detail: `Voice prod ${health.prodGit.sha?.slice(0, 7) || "unreachable"} · staging ${health.stagingGit.sha?.slice(0, 7) || "unreachable"}`,
      href: "https://railway.com/dashboard",
    },
    {
      name: "Vercel",
      detail: `Desk ${process.env.VERCEL_ENV || "local"}${vercelSha ? ` ${vercelSha}` : ""}`,
      href: "https://vercel.com/dashboard",
    },
    {
      name: "Supabase",
      detail: stats ? "Calls table readable" : "Calls table not readable",
      href: "https://supabase.com/dashboard",
    },
  ];
  return <HostingList rows={rows} />;
}

async function OpsFormSection() {
  try {
    const ops = await getOps();
    return <AdminPlatformOpsForm settings={ops.settings} persisted={ops.persisted} />;
  } catch (err) {
    logAdminError("platform", err);
    return <AdminSetupError />;
  }
}

export default async function AdminPlatformPage() {
  await requireSuperAdmin();
  return (
    <div className="space-y-6">
      <Suspense fallback={<CardSkeleton lines={0} />}>
        <HeaderSection />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={2} />}>
        <BannerSection />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={1} />}>
        <StatsSection />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={3} />}>
        <FixSection />
      </Suspense>
      <section aria-label="Providers" className="space-y-2">
        <SectionHead title="Providers" />
        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CardSkeleton lines={6} />
              <CardSkeleton lines={6} />
            </div>
          }
        >
          <ProvidersSection />
        </Suspense>
      </section>
      <Suspense fallback={<CardSkeleton lines={3} />}>
        <LinesSection />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={3} />}>
        <HostingSection />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={4} />}>
        <OpsFormSection />
      </Suspense>
    </div>
  );
}

import { AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import { PlatformRunBoard } from "@/components/PlatformRunBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stamp } from "@/components/ui/Stamp";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";

export const instant = false;

function infraRank(card: { tone: "ok" | "attention" | "neutral"; label: string }): number {
  if (card.tone === "attention") return 0;
  if (card.label === "Unknown" || card.label === "Key missing") return 1;
  if (card.tone === "neutral") return 2;
  return 3;
}

export default async function AdminPlatformPage() {
  let snapshot;
  try {
    snapshot = await evaluatePlatformOps();
  } catch (err) {
    logAdminError("platform", err);
    return <AdminSetupError />;
  }

  const infra = [...snapshot.infra].toSorted((a, b) => infraRank(a) - infraRank(b));

  return (
    <div className="space-y-8">
      <PageHeader title="Platform" meta="Status we can see. Unknown means no API." />

      <PlatformRunBoard />

      <section>
        <h2 className="text-title font-medium text-ink">Infrastructure</h2>
        <ul className="mt-3 divide-y divide-hairline">
          {infra.map((card) => (
            <li key={card.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-body font-medium text-ink">{card.title}</p>
                <p className="text-meta text-ink-2">{card.detail}</p>
              </div>
              <Stamp tone={card.tone}>{card.label}</Stamp>
            </li>
          ))}
        </ul>
      </section>

      <AdminPlatformOpsForm
        settings={snapshot.settings}
        persisted={snapshot.persisted}
        mailConfigured={snapshot.mailConfigured}
        notices={snapshot.notices}
      />
    </div>
  );
}

import { AdminPlatformOpsForm } from "@/components/AdminPlatformOpsForm";
import { AdminSetupError } from "@/components/AdminSetupError";
import { PlatformRunBoard } from "@/components/PlatformRunBoard";
import { Stamp } from "@/components/ui/Stamp";
import { deskListTitleClass } from "@/components/ui/deskChrome";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";

export const instant = false;

function stampTone(tone: "ok" | "attention" | "neutral"): "ok" | "attention" | "neutral" {
  return tone;
}

export default async function AdminPlatformPage() {
  let snapshot;
  try {
    snapshot = await evaluatePlatformOps();
  } catch (err) {
    logAdminError("platform", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className={deskListTitleClass}>Platform</h1>
        <p className="mt-1 text-meta text-ink-2">
          Status and balances we can see. Unknown means there is no API for that number.
        </p>
      </div>

      <PlatformRunBoard />

      <section>
        <h2 className="text-title font-medium text-ink">Infrastructure</h2>
        <ul className="mt-3 divide-y divide-line/70">
          {snapshot.infra.map((card) => (
            <li key={card.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-body font-medium text-ink">{card.title}</p>
                <p className="text-meta text-ink-2">{card.detail}</p>
              </div>
              <Stamp tone={stampTone(card.tone)}>{card.label}</Stamp>
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

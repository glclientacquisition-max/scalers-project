import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactNotesForm } from "@/components/ContactNotesForm";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { formatCallWhen } from "@/lib/callsTriage";
import { loadContactById, loadContactTimeline } from "@/lib/contactsLoad";
import { displayContactLastReason } from "@/lib/callSummarySentence";

function kindLabel(kind: "call" | "request" | "appointment"): string {
  if (kind === "request") return "Request";
  if (kind === "appointment") return "Visit";
  return "Call";
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  if (!tenant) notFound();

  const workspace = await createWorkspaceDataClient();
  if (!workspace) notFound();

  const { contact, error } = await loadContactById(workspace.client, tenant.id, id);
  if (error || !contact) notFound();

  const timeline = await loadContactTimeline(workspace.client, tenant.id, contact);
  const title = contact.name?.trim() || "Unknown";
  const latestCall = timeline.find((entry) => entry.kind === "call");
  const lastReason = displayContactLastReason({
    name: contact.name,
    phone: contact.phone,
    lastReason: contact.last_reason,
    latestCallReason: latestCall?.ownerReason || null,
  });
  return (
    <div className="max-w-6xl">
      <Link
        href="/contacts"
        className="text-sm font-medium text-accent-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Contacts
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
              {title}
            </h1>
            <p className="mt-2 font-mono text-sm text-ink">{contact.phone || "No phone"}</p>
          </div>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Last reason
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink">
              {lastReason || "None"}
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <ContactNotesForm contactId={contact.id} initial={contact.notes || ""} />
          </section>
        </aside>

        <div className="min-h-0 space-y-8 lg:col-span-8 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section>
            <h2 className="font-display text-2xl tracking-tight text-ink">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="mt-4 text-sm text-ink-soft">No calls or jobs yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                    <tr>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                      >
                        When
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                      >
                        Type
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                      >
                        What
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((entry) => (
                      <tr
                        key={entry.id}
                        className={[
                          "relative border-t border-line/70",
                          entry.callId ? "cursor-pointer hover:bg-accent/[0.04]" : "",
                        ].join(" ")}
                      >
                        <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-4 text-ink-soft`}>
                          {entry.callId ? (
                            <DeskRowHit href={`/calls/${entry.callId}`} label="Conversation" />
                          ) : null}
                          {formatCallWhen(entry.createdAt)}
                        </td>
                        <td className={`${deskRowMutedClass} px-5 py-4 text-ink`}>{kindLabel(entry.kind)}</td>
                        <td className={`${deskRowMutedClass} px-5 py-4`}>
                          <p className="font-medium text-ink">{entry.headline}</p>
                          {entry.detail ? (
                            <p className="mt-0.5 text-ink-soft">{entry.detail}</p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

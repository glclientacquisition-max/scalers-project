import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactNotesForm } from "@/components/ContactNotesForm";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { formatCallWhen } from "@/lib/callsTriage";
import { loadContactById, loadContactTimeline } from "@/lib/contactsLoad";

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
  const metadata =
    contact.metadata &&
    typeof contact.metadata === "object" &&
    !Array.isArray(contact.metadata)
      ? contact.metadata
      : {};
  const metaKeys = Object.keys(metadata);

  return (
    <div className="max-w-6xl">
      <Link
        href="/contacts"
        className="text-sm font-medium text-[#0096FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
      >
        Contacts
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 font-mono text-sm text-ink">{contact.phone || "No phone"}</p>
          </div>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Last reason
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink">
              {contact.last_reason?.trim() || "None"}
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <ContactNotesForm contactId={contact.id} initial={contact.notes || ""} />
          </section>

          {metaKeys.length > 0 ? (
            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                Metadata
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                {metaKeys.map((key) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-ink-soft">{key}</dt>
                    <dd className="text-right text-ink">
                      {typeof metadata[key] === "string"
                        ? metadata[key]
                        : JSON.stringify(metadata[key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
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
                      <th scope="col" className="px-5 py-4">
                        <span className="sr-only">Call</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((entry) => (
                      <tr key={entry.id} className="border-t border-line/70">
                        <td className="whitespace-nowrap px-5 py-4 text-ink-soft">
                          {formatCallWhen(entry.createdAt)}
                        </td>
                        <td className="px-5 py-4 text-ink">{kindLabel(entry.kind)}</td>
                        <td className="px-5 py-4">
                          <p className="font-medium text-ink">{entry.headline}</p>
                          {entry.detail ? (
                            <p className="mt-0.5 text-ink-soft">{entry.detail}</p>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {entry.callId ? (
                            <Link
                              href={`/calls/${entry.callId}`}
                              className="inline-flex min-h-11 items-center text-sm font-semibold text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                            >
                              Call
                            </Link>
                          ) : (
                            <span className="text-sm text-ink-soft">No call</span>
                          )}
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

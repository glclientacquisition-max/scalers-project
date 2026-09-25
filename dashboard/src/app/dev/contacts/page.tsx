import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AddContactPanel } from "@/components/AddContactPanel";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { ContactActionDock } from "@/components/ContactActionDock";
import { ContactFavouriteButton } from "@/components/ContactFavouriteButton";
import { ContactKpiStrip } from "@/components/ContactKpiStrip";
import { ContactSortSelect } from "@/components/ContactSortSelect";
import { RowIdentity } from "@/components/ui/deskRow";
import { ContactPhoneRow, ContactTableRow } from "@/components/ContactListRow";
import { ContactNameForm } from "@/components/ContactNameForm";
import { DeskRail, DeskTabBar, deskMainClass } from "@/components/DeskNav";
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskIndexLead } from "@/components/ui/DeskIndexLead";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { deskFieldClass, deskListTitleClass, deskShiftClass } from "@/components/ui/deskChrome";
import { ContactTimeline } from "@/components/ContactTimeline";
import { inboxThreadsFromContactHref } from "@/lib/inboxHref";
import {
  contactPersonFileKpiCards,
  pickFirstSeenAt,
} from "@/lib/contactPersonFile";
import {
  contactFilterPills,
  contactLastCallFact,
  type ContactListRow,
  type ContactTimelineEntry,
} from "@/lib/contactsLoad";

function ProfileLead({
  title,
  phone,
  contactId,
  name,
  lastContactAt,
  back,
}: {
  title: string;
  phone: string;
  contactId: string;
  name: string | null;
  lastContactAt?: string | null;
  back?: ReactNode;
}) {
  const lastCallFact = contactLastCallFact(lastContactAt);
  const threadsHref = inboxThreadsFromContactHref(phone);
  return (
    <div className="space-y-4">
      <DeskRecordLead
        back={back}
        trail={<ContactActionDock number={phone} />}
      >
        <div className="flex min-w-0 items-start gap-3">
          <RowIdentity name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <ContactNameForm contactId={contactId} initialName={name} title={title} />
            <p className="mt-2 font-mono text-sm text-ink">{phone}</p>
            {lastCallFact ? (
              <p className="mt-1 text-sm text-ink-soft">{lastCallFact}</p>
            ) : null}
          </div>
        </div>
      </DeskRecordLead>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <ContactFavouriteButton contactId={contactId} favourite={contactId === "ct-saved"} />
        {threadsHref ? (
          <Link
            href={threadsHref}
            data-contact-inbox-threads=""
            className={`text-sm font-medium text-[#005CCC] ${deskShiftClass} hover:underline`}
          >
            Inbox threads
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const DEV_TIMELINE: ContactTimelineEntry[] = [
  {
    id: "call:dev-1",
    kind: "call",
    createdAt: "2026-09-21T06:40:00.000Z",
    headline:
      "Asked whether the Saturday morning slot is still free after the first visit ran long",
    detail: "Called back",
    callId: "call-dev-1",
    href: "/calls/call-dev-1",
    status: "completed",
    jobStatus: null,
    stamp: "Answered",
    purpose: "answered",
  },
  {
    id: "request:dev-1",
    kind: "request",
    createdAt: "2026-09-20T15:10:00.000Z",
    headline: "Hold the blue dress",
    detail: "open",
    callId: null,
    href: null,
    status: "open",
    jobStatus: null,
    stamp: "Hold",
    purpose: "hold",
  },
];

const DEV_SAVED_HISTORY: ContactTimelineEntry[] = [
  {
    id: "appointment:dev-2",
    kind: "appointment",
    createdAt: "2026-09-18T10:00:00.000Z",
    headline: "Carpet",
    detail: "Tue",
    callId: "call-dev-2",
    href: "/calls/call-dev-2",
    status: "done",
    jobStatus: "done",
    stamp: "Visit done",
    purpose: "job",
  },
];

const DEV_ROWS: ContactListRow[] = [
  {
    id: "ct-saved",
    created_at: "2026-01-21T07:00:00.000Z",
    updated_at: "2026-09-21T07:12:00.000Z",
    tenant_id: "dev",
    phone: "+254700000002",
    name: "Amina",
    notes: null,
    last_reason: "Missed the line",
    metadata: null,
    lastContactAt: "2026-09-21T07:12:00.000Z",
    lastReasonDisplay: "Missed the line",
  },
  {
    id: "ct-unsaved",
    created_at: "2026-09-21T06:40:00.000Z",
    updated_at: "2026-09-21T06:40:00.000Z",
    tenant_id: "dev",
    phone: "+254700000001",
    name: null,
    notes: null,
    last_reason: "Callback",
    metadata: null,
    lastContactAt: "2026-09-21T06:40:00.000Z",
    lastReasonDisplay: "Callback",
  },
];

export default function DevContactsPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  const unsavedCards = contactPersonFileKpiCards({
    interactionCount: DEV_TIMELINE.length,
    visitsDoneCount: DEV_TIMELINE.filter(
      (entry) => String(entry.jobStatus || "").toLowerCase() === "done"
    ).length,
    firstSeenAt: pickFirstSeenAt(
      DEV_ROWS[1].created_at,
      ...DEV_TIMELINE.map((entry) => entry.createdAt)
    ),
    now: new Date("2026-09-21T08:00:00+03:00"),
  });
  const savedCards = contactPersonFileKpiCards({
    interactionCount: DEV_SAVED_HISTORY.length,
    visitsDoneCount: DEV_SAVED_HISTORY.filter(
      (entry) => String(entry.jobStatus || "").toLowerCase() === "done"
    ).length,
    firstSeenAt: pickFirstSeenAt(
      DEV_ROWS[0].created_at,
      ...DEV_SAVED_HISTORY.map((entry) => entry.createdAt)
    ),
    now: new Date("2026-09-21T08:00:00+03:00"),
  });

  return (
    <div className="desk-theme flex min-h-dvh min-w-0 overflow-x-clip md:h-dvh">
      <DeskRail needsCount={0} homeHref="/dev/contacts" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main className={deskMainClass}>
          <section className="mb-10">
            <header className="space-y-3">
              <h1 className={deskListTitleClass}>Contacts</h1>
              <DeskIndexLead>
                <div className="flex w-full min-w-0 flex-row items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor="dev-contacts-search">
                      Search contacts
                    </label>
                    <input
                      id="dev-contacts-search"
                      type="search"
                      defaultValue=""
                      placeholder="Name or number"
                      className={deskFieldClass}
                      readOnly
                    />
                  </div>
                  <div className="shrink-0">
                    <AddContactPanel />
                  </div>
                </div>
              </DeskIndexLead>
              <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <InboxFilterPills
                  label="Filter contacts"
                  active="all"
                  items={contactFilterPills({
                    recents: 2,
                    favourites: 1,
                    unsaved: 1,
                  }).map((item) => ({ ...item, href: "/dev/contacts" }))}
                />
                <ContactSortSelect saved="all" sort="recent" q="" />
              </div>
            </header>
            <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
              {DEV_ROWS.map((row) => (
                <ContactPhoneRow
                  key={row.id}
                  row={row}
                  href="/dev/contacts/file"
                />
              ))}
            </ul>
            <div className="mt-6 hidden min-w-0 md:mt-8 md:block">
              <DeskDataTable minWidthClass="min-w-0">
                <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:px-5 lg:py-4">
                      Name
                    </th>
                    <th scope="col" className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:table-cell lg:px-5 lg:py-4">
                      Phone
                    </th>
                    <th scope="col" className="px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:px-5 lg:py-4">
                      Last call
                    </th>
                    <th scope="col" className="w-px px-3 py-3 lg:px-5 lg:py-4">
                      <span className="sr-only">Call and WhatsApp</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DEV_ROWS.map((row) => (
                    <ContactTableRow
                      key={row.id}
                      row={row}
                      href="/dev/contacts/file"
                    />
                  ))}
                </tbody>
              </DeskDataTable>
            </div>
          </section>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <section className="max-w-md space-y-5">
              <ProfileLead
                title="Name this caller"
                phone="+254700000001"
                contactId="ct-unsaved"
                name={null}
                lastContactAt="2026-09-21T06:40:00.000Z"
                back={<DeskBack href="/dev/contacts">Contacts</DeskBack>}
              />
              <ContactKpiStrip cards={unsavedCards} />
              <section className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  Last reason
                </h2>
                <CallSummaryCard
                  name={null}
                  callerNumber="+254700000001"
                  want="Callback"
                  done={null}
                  mood="Urgent"
                  next="Call them back"
                />
              </section>
              <section>
                <h2 className="font-display text-2xl tracking-tight text-ink">History</h2>
                <ContactTimeline entries={DEV_TIMELINE} />
              </section>
            </section>
            <section className="max-w-md space-y-5">
              <ProfileLead
                title="Amina"
                phone="+254700000002"
                contactId="ct-saved"
                name="Amina"
                lastContactAt="2026-09-21T07:12:00.000Z"
                back={<DeskBack href="/dev/contacts">Contacts</DeskBack>}
              />
              <ContactKpiStrip cards={savedCards} />
              <section className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  Last reason
                </h2>
                <CallSummaryCard
                  name="Amina"
                  callerNumber="+254700000002"
                  want="Missed the line"
                  done={null}
                  mood="Urgent"
                  next="Call them back"
                />
              </section>
              <section>
                <h2 className="font-display text-2xl tracking-tight text-ink">History</h2>
                <ContactTimeline entries={DEV_SAVED_HISTORY} />
              </section>
            </section>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}

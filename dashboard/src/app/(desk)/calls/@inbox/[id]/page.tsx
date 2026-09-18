import { InboxWorkspace } from "@/components/InboxWorkspace";

export default async function InboxCallSlot({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    from?: string;
    view?: string;
    week?: string;
    day?: string;
    q?: string;
    page?: string;
    status?: string;
    purpose?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <InboxWorkspace
      searchParams={{
        page: sp.page,
        status: sp.status,
        purpose: sp.purpose || sp.from,
        from: sp.from,
        q: sp.q,
        view: sp.view,
        week: sp.week,
        day: sp.day,
      }}
      openCallId={id}
    />
  );
}
